<?php

namespace App\Services\Reservations;

use App\Enums\AuditAction;
use App\Enums\ReservationStatus;
use App\Enums\UnitStatus;
use App\Models\Building;
use App\Models\Client;
use App\Models\Reservation;
use App\Models\ReservationPayment;
use App\Models\Unit;
use App\Services\Audit\AuditLogger;
use App\Support\Transactions\Operation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ReservationService
{
    public function __construct(
        private Operation $operation,
        private AuditLogger $audit
    ) {}

    public function create(array $data, $actor): Reservation
    {
        return DB::transaction(function () use ($data, $actor) {
            // Validate unit belongs to building if both set
            if ($data['unit_id'] ?? null) {
                $unit = Unit::where('id', $data['unit_id'])->first();
                if (! $unit) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('reservations.unit_not_found'),
                    ]);
                }

                // Building must match unit's building
                if (isset($data['building_id']) && $data['building_id'] !== $unit->building_id) {
                    throw ValidationException::withMessages([
                        'building_id' => __('reservations.building_must_match_unit'),
                    ]);
                }

                // A unit that is not sold/rented is off the market for both.
                if (! $unit->is_sellable) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('units.not_available'),
                    ]);
                }

                // Derive from unit - ignore client-sent values
                $data['building_id'] = $unit->building_id;
                $data['unit_type'] = $unit->type->value;
                $data['unit_activity'] = $unit->activity;

                // Only ONE active reservation per unit - row lock
                $unit->lockForUpdate();
                $existingActive = $unit->reservations()->where('status', 'active')->exists();
                if ($existingActive) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('reservations.unit_already_reserved'),
                    ]);
                }
            } else {
                // Building-level reservation
                if (isset($data['building_id'])) {
                    $building = Building::where('id', $data['building_id'])->first();
                    if (! $building) {
                        throw ValidationException::withMessages([
                            'building_id' => __('reservations.building_not_found'),
                        ]);
                    }
                    $data['unit_type'] = $data['unit_type'] ?? null;
                    $data['unit_activity'] = $data['unit_activity'] ?? null;
                }
            }

            $reservation = Reservation::create([
                'client_id' => $data['client_id'],
                'building_id' => $data['building_id'] ?? null,
                'unit_id' => $data['unit_id'] ?? null,
                'unit_type' => $data['unit_type'] ?? null,
                'unit_activity' => $data['unit_activity'] ?? null,
                'reservation_date' => $data['reservation_date'],
                'status' => ReservationStatus::ACTIVE,
            ]);

            // Update unit status to reserved if unit assigned
            if ($reservation->unit_id) {
                $unit = Unit::find($reservation->unit_id);
                $unit->update(['status' => UnitStatus::RESERVED]);
            }

            // Create first payment if provided
            if (isset($data['first_payment']) && $data['first_payment']) {
                $this->createPayment(
                    $reservation->id,
                    [
                        'amount' => $data['first_payment']['amount'],
                        'paid_at' => $data['first_payment']['paid_at'] ?? now()->toDateString(),
                        'payment_method' => $data['first_payment']['payment_method'] ?? null,
                        'notes' => $data['first_payment']['notes'] ?? null,
                        'created_by' => $actor->id,
                    ],
                    $actor
                );
            }

            $this->audit->log(
                action: AuditAction::CREATE->value,
                entityType: 'reservations',
                entityId: $reservation->id,
                newValues: $this->safeReservationArray($reservation),
                reason: 'Reservation created by '.$actor->name,
            );

            return $reservation->load('client', 'building', 'unit', 'payments');
        });
    }

    /**
     * Edit an active reservation: client, unit/building and date (owner decision 2026-11-21).
     *
     * Changing the unit frees the old one («متاحة») and reserves the new one, with the same guards a
     * new reservation gets: the target must be sellable, free (no other active reservation, no active
     * or drafted contract) and in the same building as a building-level reservation is not required —
     * a unit implies its building. Payments are never touched here; a converted or cancelled
     * reservation is locked.
     */
    public function update(Reservation $reservation, array $data, $actor): Reservation
    {
        if (! $reservation->isActive()) {
            throw ValidationException::withMessages([
                'reservation' => __('reservations.cannot_edit_non_active'),
            ]);
        }

        return DB::transaction(function () use ($reservation, $data, $actor) {
            $reservation = Reservation::whereKey($reservation->id)->lockForUpdate()->firstOrFail();

            if (! $reservation->isActive()) {
                throw ValidationException::withMessages([
                    'reservation' => __('reservations.cannot_edit_non_active'),
                ]);
            }

            $oldValues = $this->safeReservationArray($reservation);
            $oldUnitId = $reservation->unit_id;
            $newUnitId = array_key_exists('unit_id', $data) ? $data['unit_id'] : $oldUnitId;
            $newUnitId = $newUnitId !== null ? (int) $newUnitId : null;

            $buildingId = null;
            $unitType = null;
            $unitActivity = null;

            if ($newUnitId) {
                $unit = Unit::whereKey($newUnitId)->lockForUpdate()->first();

                if (! $unit) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('reservations.unit_not_found'),
                    ]);
                }

                if (! $unit->is_sellable) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('units.not_available'),
                    ]);
                }

                // Moving to another unit: it has to be free. Staying on the same unit is always fine.
                if ($newUnitId !== (int) $oldUnitId) {
                    if ($unit->status !== UnitStatus::AVAILABLE) {
                        throw ValidationException::withMessages([
                            'unit_id' => __('reservations.unit_already_reserved'),
                        ]);
                    }

                    if ($unit->reservations()->where('status', ReservationStatus::ACTIVE->value)->exists()) {
                        throw ValidationException::withMessages([
                            'unit_id' => __('reservations.unit_already_reserved'),
                        ]);
                    }

                    if ($unit->contracts()->whereIn('status', ['active', 'draft'])->exists()) {
                        throw ValidationException::withMessages([
                            'unit_id' => __('reservations.unit_has_contract'),
                        ]);
                    }
                }

                // The unit decides its building; body values are ignored.
                $buildingId = $unit->building_id;
                $unitType = $unit->type->value;
                $unitActivity = $unit->activity;
            } else {
                $buildingId = $data['building_id'] ?? $reservation->building_id;

                if (! $buildingId) {
                    throw ValidationException::withMessages([
                        'building_id' => __('reservations.building_required'),
                    ]);
                }

                if (! Building::whereKey($buildingId)->exists()) {
                    throw ValidationException::withMessages([
                        'building_id' => __('reservations.building_not_found'),
                    ]);
                }

                $buildingId = (int) $buildingId;
            }

            $reservation->update([
                'client_id' => $data['client_id'] ?? $reservation->client_id,
                'building_id' => $buildingId,
                'unit_id' => $newUnitId,
                'unit_type' => $unitType,
                'unit_activity' => $unitActivity,
                'reservation_date' => $data['reservation_date'] ?? $reservation->reservation_date,
            ]);

            if ($newUnitId !== (int) $oldUnitId) {
                // Give the old unit back only if this reservation is the one holding it.
                if ($oldUnitId) {
                    $oldUnit = Unit::whereKey($oldUnitId)->lockForUpdate()->first();
                    if ($oldUnit && $oldUnit->status === UnitStatus::RESERVED) {
                        $oldUnit->update(['status' => UnitStatus::AVAILABLE]);
                    }
                }

                if ($newUnitId) {
                    Unit::whereKey($newUnitId)->update(['status' => UnitStatus::RESERVED]);
                }
            }

            $this->audit->log(
                action: AuditAction::UPDATE->value,
                entityType: 'reservations',
                entityId: $reservation->id,
                oldValues: $oldValues,
                newValues: $this->safeReservationArray($reservation->fresh()),
                changedFields: array_keys(array_filter(
                    $this->safeReservationArray($reservation->fresh()),
                    fn ($value, $key) => ($oldValues[$key] ?? null) != $value,
                    ARRAY_FILTER_USE_BOTH
                )),
                isAutomatic: false,
                reason: 'Reservation edited by '.$actor->name,
            );

            return $reservation->fresh()->load('client', 'building', 'unit', 'payments');
        });
    }

    public function cancel(Reservation $reservation, string $reason, $actor): Reservation
    {
        if (! $reservation->isActive()) {
            throw ValidationException::withMessages([
                'reservation' => __('reservations.cannot_cancel_non_active'),
            ]);
        }

        return DB::transaction(function () use ($reservation, $reason) {
            $oldValues = $this->safeReservationArray($reservation);

            $reservation->update([
                'status' => ReservationStatus::CANCELLED,
                'cancelled_at' => $this->operation->now(),
                'cancellation_reason' => $reason,
            ]);

            // Unit returns to available
            if ($reservation->unit_id) {
                $unit = Unit::find($reservation->unit_id);
                $unit->update(['status' => UnitStatus::AVAILABLE]);
            }

            $this->audit->log(
                action: AuditAction::UPDATE->value,
                entityType: 'reservations',
                entityId: $reservation->id,
                oldValues: $oldValues,
                newValues: $this->safeReservationArray($reservation->fresh()),
                changedFields: ['status', 'cancelled_at', 'cancellation_reason'],
                reason: 'Reservation cancelled: '.$reason,
            );

            return $reservation->fresh();
        });
    }

    /**
     * Convert reservation: returns pre-filled data for contract creation.
     * The actual contract is created via contracts endpoint.
     */
    public function convert(Reservation $reservation, $actor): array
    {
        if (! $reservation->isActive()) {
            throw ValidationException::withMessages([
                'reservation' => __('reservations.cannot_convert_non_active'),
            ]);
        }

        $data = [
            'reservation_id' => $reservation->id,
            'client_id' => $reservation->client_id,
            'unit_id' => $reservation->unit_id,
            'unit_type' => $reservation->unit_type,
            'unit_activity' => $reservation->unit_activity,
        ];

        $this->audit->log(
            action: AuditAction::CONVERT->value,
            entityType: 'reservations',
            entityId: $reservation->id,
            newValues: $data,
            isAutomatic: true,
            reason: 'Reservation converted to contract by '.$actor->name,
        );

        return $data;
    }

    private function createPayment(int $reservationId, array $data, $actor): void
    {
        $amount = (float) $data['amount'];
        if ($amount <= 0) {
            throw ValidationException::withMessages([
                'amount' => __('reservation_payments.amount_must_be_positive'),
            ]);
        }

        $payment = ReservationPayment::create([
            'reservation_id' => $reservationId,
            'amount' => $data['amount'],
            'paid_at' => $data['paid_at'],
            'payment_method' => $data['payment_method'] ?? null,
            'notes' => $data['notes'] ?? null,
            'status' => 'valid',
            'created_by' => $actor->id,
        ]);

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'reservation_payments',
            entityId: $payment->id,
            newValues: [
                'reservation_id' => $reservationId,
                'amount' => $data['amount'],
                'paid_at' => $data['paid_at'],
            ],
            isAutomatic: true,
            reason: 'Payment recorded for reservation #'.$reservationId,
        );
    }

    private function safeReservationArray(Reservation $r): array
    {
        return [
            'id' => $r->id,
            'client_id' => $r->client_id,
            'building_id' => $r->building_id,
            'unit_id' => $r->unit_id,
            'unit_type' => $r->unit_type,
            'unit_activity' => $r->unit_activity,
            'reservation_date' => $r->reservation_date,
            'status' => $r->status?->value,
            'deposit_paid' => $r->deposit_paid,
        ];
    }
}
