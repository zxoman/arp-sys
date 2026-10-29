<?php

namespace App\Services\Units;

use App\Models\Building;
use App\Models\Floor;
use App\Models\Unit;
use App\Enums\AuditAction;
use App\Enums\ContractStatus;
use App\Enums\ReservationStatus;
use App\Enums\UnitPurpose;
use App\Enums\UnitStatus;
use App\Services\Audit\AuditLogger;
use App\Support\Money\Money;
use App\Support\Transactions\Operation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class UnitService
{
    public function __construct(
        private Operation $operation,
        private AuditLogger $audit
    ) {
    }

    public function create(array $data, $actor): Unit
    {
        return DB::transaction(function () use ($data, $actor) {
            $building = Building::findOrFail($data['building_id']);

            // Validate floor belongs to same building
            $floor = Floor::where('id', $data['floor_id'])
                ->where('building_id', $building->id)
                ->first();

            if (!$floor) {
                throw ValidationException::withMessages([
                    'floor_id' => __('units.floor_not_in_building'),
                ]);
            }

            // Validate activity is one of building's activities
            $activity = $data['activity'] ?? null;
            if (!$activity) {
                // Auto-set if building has only one activity
                $activities = $building->activities()->pluck('activity')->all();
                if (count($activities) === 1) {
                    $activity = $activities[0];
                } else {
                    throw ValidationException::withMessages([
                        'activity' => __('units.activity_required'),
                    ]);
                }
            }

            if (!$building->activityExists($activity)) {
                throw ValidationException::withMessages([
                    'activity' => __('units.activity_not_in_building'),
                ]);
            }

            // Validate area > 0
            if (!isset($data['area']) || (float) $data['area'] <= 0) {
                throw ValidationException::withMessages([
                    'area' => __('units.area_must_be_positive'),
                ]);
            }

            $purpose = $this->resolvePurpose($data);
            $isSellable = array_key_exists('is_sellable', $data) ? (bool) $data['is_sellable'] : true;
            $reason = $this->resolveNonSellableReason($isSellable, $data['non_sellable_reason'] ?? null);
            $salePrice = $data['sale_price'] ?? null;

            if ($purpose === UnitPurpose::RENT) {
                if ($salePrice !== null) {
                    throw ValidationException::withMessages([
                        'sale_price' => __('units.sale_price_not_allowed_for_rent'),
                    ]);
                }
                $salePrice = null;
            }

            $unit = Unit::create([
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => $data['name'],
                'type' => $data['type'],
                'activity' => $activity,
                'purpose' => $purpose,
                'area' => $data['area'],
                'price_per_meter' => $data['price_per_meter'] ?? null,
                'sale_price' => $salePrice,
                'is_sellable' => $isSellable,
                'non_sellable_reason' => $reason,
                'rooms' => $data['rooms'] ?? null,
                'bathrooms' => $data['bathrooms'] ?? null,
                'status' => UnitStatus::AVAILABLE,
            ]);

            // Update floor units count
            $floor->increment('units_count');

            $this->audit->log(
                action: AuditAction::REJECTED_OPERATION->value,
                entityType: 'units',
                entityId: $unit->id,
                newValues: $this->safeUnitArray($unit),
                reason: 'Unit created by ' . $actor->name,
            );

            return $unit->load('building', 'floor');
        });
    }

    public function update(Unit $unit, array $data, $actor): Unit
    {
        return DB::transaction(function () use ($unit, $data, $actor) {
            $oldValues = $this->safeUnitArray($unit);

            // building_id is immutable (handled by model boot, but double check)
            if (isset($data['building_id']) && $data['building_id'] !== $unit->building_id) {
                throw ValidationException::withMessages([
                    'building_id' => __('units.building_id_immutable'),
                ]);
            }

            // Validate floor belongs to same building if changing floor
            if (isset($data['floor_id']) && $data['floor_id'] !== $unit->floor_id) {
                $floor = Floor::where('id', $data['floor_id'])
                    ->where('building_id', $unit->building_id)
                    ->first();

                if (!$floor) {
                    throw ValidationException::withMessages([
                        'floor_id' => __('units.floor_not_in_building'),
                    ]);
                }

                // Update floor units count
                $unit->floor->decrement('units_count');
                $floor->increment('units_count');
            }

            // Validate activity is one of building's activities
            $activity = $data['activity'] ?? $unit->activity;
            if ($activity !== $unit->activity && !$unit->building->activityExists($activity)) {
                throw ValidationException::withMessages([
                    'activity' => __('units.activity_not_in_building'),
                ]);
            }

            // Block editing area/price_per_meter when unit is sold
            if ($unit->status === UnitStatus::SOLD) {
                if (isset($data['area']) && $data['area'] !== $unit->area) {
                    throw ValidationException::withMessages([
                        'area' => __('units.cannot_edit_sold_unit'),
                    ]);
                }
                if (isset($data['price_per_meter']) && $data['price_per_meter'] !== $unit->price_per_meter) {
                    throw ValidationException::withMessages([
                        'price_per_meter' => __('units.cannot_edit_sold_unit'),
                    ]);
                }
            }

            // Purpose / sale price / sellability are frozen once the unit is sold or rented.
            $this->assertPurposeAndSaleFieldsUnlocked($unit, $data);

            $purpose = $this->resolvePurpose($data, $unit);
            $isSellable = array_key_exists('is_sellable', $data) ? (bool) $data['is_sellable'] : (bool) $unit->is_sellable;
            $reason = $this->resolveNonSellableReason(
                $isSellable,
                array_key_exists('non_sellable_reason', $data) ? $data['non_sellable_reason'] : $unit->non_sellable_reason
            );

            $salePrice = array_key_exists('sale_price', $data) ? $data['sale_price'] : $unit->sale_price;
            if ($purpose === UnitPurpose::RENT) {
                if (array_key_exists('sale_price', $data) && $data['sale_price'] !== null) {
                    throw ValidationException::withMessages([
                        'sale_price' => __('units.sale_price_not_allowed_for_rent'),
                    ]);
                }
                // Switching to rent-only clears the sale price.
                $salePrice = null;
            }

            try {
            $unit->update([
                'name' => $data['name'] ?? $unit->name,
                'floor_id' => $data['floor_id'] ?? $unit->floor_id,
                'type' => $data['type'] ?? $unit->type,
                'activity' => $activity,
                'purpose' => $purpose,
                'area' => $data['area'] ?? $unit->area,
                'price_per_meter' => $data['price_per_meter'] ?? $unit->price_per_meter,
                'sale_price' => $salePrice,
                'is_sellable' => $isSellable,
                'non_sellable_reason' => $reason,
                'rooms' => $data['rooms'] ?? $unit->rooms,
                'bathrooms' => $data['bathrooms'] ?? $unit->bathrooms,
                // status is NOT editable via API - it's automatic
            ]);
        } catch (\RuntimeException $e) {
            throw ValidationException::withMessages([
                'building_id' => $e->getMessage(),
            ]);
        }

            $this->audit->log(
                action: AuditAction::REJECTED_OPERATION->value,
                entityType: 'units',
                entityId: $unit->id,
                oldValues: $oldValues,
                newValues: $this->safeUnitArray($unit->fresh()),
                changedFields: array_keys(array_filter([
                    'name' => $data['name'] ?? null,
                    'floor_id' => $data['floor_id'] ?? null,
                    'type' => $data['type'] ?? null,
                    'activity' => $data['activity'] ?? null,
                    'purpose' => $data['purpose'] ?? null,
                    'area' => $data['area'] ?? null,
                    'price_per_meter' => $data['price_per_meter'] ?? null,
                    'sale_price' => $data['sale_price'] ?? null,
                    'is_sellable' => $data['is_sellable'] ?? null,
                    'non_sellable_reason' => $data['non_sellable_reason'] ?? null,
                    'rooms' => $data['rooms'] ?? null,
                    'bathrooms' => $data['bathrooms'] ?? null,
                ])),
                reason: 'Unit updated by ' . $actor->name,
            );

            return $unit->fresh()->load('building', 'floor');
        });
    }

    public function delete(Unit $unit, $actor): void
    {
        // Soft delete is blocked while the unit has an active reservation or any contract that
        // was not cancelled (BRIEF 2.3). Cancelled contracts and cancelled reservations don't count.
        $hasActiveReservation = $unit->reservations()
            ->where('status', ReservationStatus::ACTIVE->value)
            ->exists();

        $hasLiveContract = $unit->contracts()
            ->where('status', '!=', ContractStatus::CANCELLED->value)
            ->exists();

        if ($hasActiveReservation || $hasLiveContract) {
            throw ValidationException::withMessages([
                'unit' => __('units.cannot_delete_with_reservation_or_contract'),
            ]);
        }

        // Decrement floor units count
        $unit->floor->decrement('units_count');

        $oldValues = $this->safeUnitArray($unit);
        $unit->delete();

        $this->audit->log(
            action: AuditAction::DELETE->value,
            entityType: 'units',
            entityId: $unit->id,
            oldValues: $oldValues,
            reason: 'Unit deleted by ' . $actor->name,
        );
    }

    /**
     * Update unit status automatically (called by reservation/contract services).
     */
    public function setStatus(Unit $unit, UnitStatus $status, string $reason, $actor): Unit
    {
        $oldValues = $this->safeUnitArray($unit);
        $oldStatus = $unit->status;

        $unit->update(['status' => $status->value]);

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'units',
            entityId: $unit->id,
            oldValues: $oldValues,
            newValues: $this->safeUnitArray($unit->fresh()),
            changedFields: ['status'],
            isAutomatic: true,
            reason: $reason,
        );

        return $unit->fresh();
    }

    private function safeUnitArray(Unit $unit): array
    {
        return [
            'id' => $unit->id,
            'building_id' => $unit->building_id,
            'floor_id' => $unit->floor_id,
            'name' => $unit->name,
            'type' => $unit->type?->value,
            'activity' => $unit->activity,
            'purpose' => $unit->purpose?->value,
            'area' => $unit->area,
            'price_per_meter' => $unit->price_per_meter,
            'sale_price' => $unit->sale_price,
            'is_sellable' => $unit->is_sellable,
            'non_sellable_reason' => $unit->non_sellable_reason,
            'rooms' => $unit->rooms,
            'bathrooms' => $unit->bathrooms,
            'status' => $unit->status?->value,
            'total_price' => $unit->total_price,
        ];
    }

    /** Sale/rent purpose from the request, falling back to the unit's current value (default `both`). */
    private function resolvePurpose(array $data, ?Unit $unit = null): UnitPurpose
    {
        if (array_key_exists('purpose', $data) && $data['purpose'] !== null) {
            return UnitPurpose::from($data['purpose']);
        }

        return $unit?->purpose ?? UnitPurpose::BOTH;
    }

    /** A unit that isn't sellable must say why; a sellable one never keeps a stale reason. */
    private function resolveNonSellableReason(bool $isSellable, ?string $reason): ?string
    {
        if ($isSellable) {
            return null;
        }

        $reason = trim((string) $reason);

        if ($reason === '') {
            throw ValidationException::withMessages([
                'non_sellable_reason' => __('units.non_sellable_reason_required'),
            ]);
        }

        return $reason;
    }

    /**
     * Purpose, sale price and the sellable flag can't change once the unit is sold or rented
     * (same guard as area/price_per_meter).
     */
    private function assertPurposeAndSaleFieldsUnlocked(Unit $unit, array $data): void
    {
        if (!in_array($unit->status, [UnitStatus::SOLD, UnitStatus::RENTED], true)) {
            return;
        }

        $changedField = null;

        if (array_key_exists('purpose', $data) && $data['purpose'] !== null && $data['purpose'] !== $unit->purpose?->value) {
            $changedField = 'purpose';
        }

        if (!$changedField && array_key_exists('is_sellable', $data) && (bool) $data['is_sellable'] !== (bool) $unit->is_sellable) {
            $changedField = 'is_sellable';
        }

        if (!$changedField && array_key_exists('non_sellable_reason', $data) && trim((string) $data['non_sellable_reason']) !== (string) $unit->non_sellable_reason) {
            $changedField = 'non_sellable_reason';
        }

        if (!$changedField && array_key_exists('sale_price', $data) && !$this->sameMoney($data['sale_price'], $unit->sale_price)) {
            $changedField = 'sale_price';
        }

        if ($changedField) {
            throw ValidationException::withMessages([
                $changedField => __('units.cannot_edit_locked_unit'),
            ]);
        }
    }

    /** Money equality without floats: compares the two amounts as decimals. */
    private function sameMoney($a, $b): bool
    {
        $a = $a === null ? null : (string) $a;
        $b = $b === null ? null : (string) $b;

        if ($a === null || $b === null) {
            return $a === $b;
        }

        return Money::fromString($a)->equal(Money::fromString($b));
    }
}
