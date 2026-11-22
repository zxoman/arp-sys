<?php

namespace App\Services\Contracts;

use App\Enums\AuditAction;
use App\Enums\ContractStatus;
use App\Enums\ContractType;
use App\Enums\InstallmentStatus;
use App\Enums\PaymentStatus;
use App\Enums\ReservationStatus;
use App\Enums\UnitStatus;
use App\Models\Contract;
use App\Models\ContractDownPayment;
use App\Models\Installment;
use App\Models\Reservation;
use App\Models\Unit;
use App\Services\Audit\AuditLogger;
use App\Support\Money\MoneyCalculator;
use App\Support\Transactions\Operation;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ContractService
{
    public function __construct(
        private Operation $operation,
        private AuditLogger $audit,
        private InstallmentService $installments
    ) {}

    /**
     * Create a contract.
     *
     * `status` is `active` (default) or `draft`. A draft keeps its schedule in `draft_schedule` and
     * changes nothing else: no installments, no unit status, no reservation conversion — that all
     * happens when it is posted (`post()`).
     *
     * The schedule may be sent explicitly (`schedule[]` of due_date/amount, the contracts screen does
     * this so the user can shape it), or left to the server (`installments_count` + interval + first
     * date, or one row per month for a lease).
     */
    public function create(array $data, $actor): Contract
    {
        return DB::transaction(function () use ($data, $actor) {
            $type = $data['type'];
            $isDraft = ($data['status'] ?? ContractStatus::ACTIVE->value) === ContractStatus::DRAFT->value;

            // If from reservation, lock reservation and auto-fill client/unit
            $reservation = null;
            if (! empty($data['reservation_id'])) {
                $reservation = Reservation::where('id', $data['reservation_id'])
                    ->where('status', 'active')
                    ->first();

                if (! $reservation) {
                    throw ValidationException::withMessages([
                        'reservation_id' => __('contracts.reservation_not_found_or_not_active'),
                    ]);
                }

                // Auto-fill client and unit from reservation
                $data['client_id'] = $reservation->client_id;
                $data['unit_id'] = $reservation->unit_id;
                $data['type'] = $type = $data['type'] ?? ContractType::SALE->value;

                // If no unit on reservation yet, must be assigned first
                if (! $reservation->unit_id) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('contracts.reservation_has_no_unit'),
                    ]);
                }

                // The agreed price is entered with the contract (a reservation carries no price).
            }

            // Validate direct contract on unit with active reservation is blocked
            if (! $reservation && $data['unit_id']) {
                $unit = Unit::find($data['unit_id']);
                if ($unit && $unit->reservations()->where('status', 'active')->exists()) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('contracts.unit_has_active_reservation'),
                    ]);
                }
            }

            // Validate unit belongs to same building as reservation's building if both set
            if ($data['unit_id'] ?? null) {
                $unit = Unit::find($data['unit_id']);
                if (! $unit) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('contracts.unit_not_found'),
                    ]);
                }

                if ($reservation && $reservation->building_id !== $unit->building_id) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('contracts.unit_not_in_reservation_building'),
                    ]);
                }

                $this->assertUnitOfferedFor($unit, $type);
            }

            $explicitRows = $this->explicitRows($data);
            $totalPrice = $this->resolveTotalPrice($data, $type, $explicitRows);

            $agreedDownPayment = round((float) ($data['agreed_down_payment'] ?? 0), 2);
            $reservationPayments = $reservation ? (float) $reservation->deposit_paid : 0;

            if ($agreedDownPayment < $reservationPayments) {
                throw ValidationException::withMessages([
                    'agreed_down_payment' => __('contracts.down_payment_less_than_reservation_payments'),
                ]);
            }

            if ($agreedDownPayment > $totalPrice) {
                throw ValidationException::withMessages([
                    'agreed_down_payment' => __('contracts.down_payment_exceeds_price'),
                ]);
            }

            $rows = $explicitRows ?: $this->generatedRows($data, $type, $totalPrice, $agreedDownPayment);
            $regularRows = $this->regularRows($rows);

            // Generate contract number (sequential per year)
            $number = $this->generateContractNumber($type, $data['contract_date']);

            $contract = Contract::create([
                'number' => $number,
                'reservation_id' => $reservation?->id,
                'type' => $type,
                'client_id' => $data['client_id'],
                'unit_id' => $data['unit_id'],
                'contract_date' => $data['contract_date'],
                'total_price' => $totalPrice,
                'discount' => round((float) ($data['discount'] ?? 0), 2),
                'discount_reason' => $data['discount_reason'] ?? null,
                'agreed_down_payment' => $agreedDownPayment,
                'installments_count' => $isDraft ? 0 : count($regularRows),
                'first_installment_date' => $isDraft || ! $regularRows ? null : $this->firstDate($regularRows),
                'interval_months' => $data['interval_months'] ?? null,
                'monthly_rent' => $data['monthly_rent'] ?? null,
                'duration_months' => $data['duration_months'] ?? null,
                'start_date' => $data['start_date'] ?? null,
                'end_date' => $data['end_date'] ?? $this->leaseEndDate($data),
                'security_deposit' => round((float) ($data['security_deposit'] ?? 0), 2),
                'advance_months' => (int) ($data['advance_months'] ?? 0),
                'annual_increase_pct' => $data['annual_increase_pct'] ?? null,
                'increase_from_year' => $data['increase_from_year'] ?? null,
                'draft_schedule' => $isDraft ? $rows : null,
                'notes' => $data['notes'] ?? null,
                'status' => $isDraft ? ContractStatus::DRAFT->value : ContractStatus::ACTIVE->value,
            ]);

            if (! $isDraft) {
                $this->writeSchedule($contract, $rows, $actor);
                $this->completeOperation($contract, $reservation);
            }

            $this->audit->log(
                action: AuditAction::CREATE->value,
                entityType: 'contracts',
                entityId: $contract->id,
                newValues: $this->safeContractArray($contract),
                isAutomatic: false,
                reason: ($isDraft ? 'Contract drafted by ' : 'Contract created by ').$actor->name,
            );

            return $contract->load('client', 'unit.building', 'reservation', 'installments', 'downPayments');
        });
    }

    /**
     * Post a draft: create the installments (from `schedule` or the draft's own schedule), sell/rent the
     * unit and mark the reservation converted. Same transaction, same guards as a direct creation.
     */
    public function post(Contract $contract, array $data, $actor): Contract
    {
        if ($contract->status !== ContractStatus::DRAFT) {
            throw ValidationException::withMessages([
                'contract' => __('contracts.not_a_draft'),
            ]);
        }

        return DB::transaction(function () use ($contract, $data, $actor) {
            $contract = Contract::whereKey($contract->id)->lockForUpdate()->firstOrFail();

            if ($contract->status !== ContractStatus::DRAFT) {
                throw ValidationException::withMessages([
                    'contract' => __('contracts.not_a_draft'),
                ]);
            }

            $unit = Unit::whereKey($contract->unit_id)->lockForUpdate()->first();
            if (! $unit) {
                throw ValidationException::withMessages([
                    'unit_id' => __('contracts.unit_not_found'),
                ]);
            }
            $this->assertUnitOfferedFor($unit, $contract->type->value);

            $rows = $this->explicitRows($data)
                ?: ($contract->draft_schedule ?? [])
                ?: $this->generatedRows($data, $contract->type->value, (float) $contract->total_price, (float) $contract->agreed_down_payment);

            $regularRows = $this->regularRows($rows);

            $contract->update([
                'status' => ContractStatus::ACTIVE->value,
                'installments_count' => count($regularRows),
                'first_installment_date' => $regularRows ? $this->firstDate($regularRows) : null,
                'draft_schedule' => null,
                'notes' => $data['notes'] ?? $contract->notes,
            ]);

            $this->writeSchedule($contract, $rows, $actor);
            $this->completeOperation($contract, $contract->reservation);

            $this->audit->log(
                action: AuditAction::UPDATE->value,
                entityType: 'contracts',
                entityId: $contract->id,
                newValues: $this->safeContractArray($contract),
                changedFields: ['status', 'installments_count', 'first_installment_date'],
                isAutomatic: false,
                reason: 'Draft posted by '.$actor->name,
            );

            return $contract->fresh()->load('client', 'unit.building', 'reservation', 'installments', 'downPayments');
        });
    }

    /**
     * Edit a contract (owner decision 2026-11-21).
     *
     * A **draft** changes anything. An **active** contract may change its data and its money, but only
     * the rows that never collected a penny are re-planned: an installment with `paid_amount > 0` (or
     * one that ever carried a payment line) keeps its amount and due date, receipts are never touched,
     * and the new price may not fall below what was actually collected.
     */
    public function update(Contract $contract, array $data, $actor): Contract
    {
        if ($contract->isCancelled()) {
            throw ValidationException::withMessages([
                'contract' => __('contracts.cannot_edit_cancelled'),
            ]);
        }

        return DB::transaction(function () use ($contract, $data, $actor) {
            $contract = Contract::whereKey($contract->id)->lockForUpdate()->firstOrFail();

            if ($contract->isCancelled()) {
                throw ValidationException::withMessages([
                    'contract' => __('contracts.cannot_edit_cancelled'),
                ]);
            }

            $oldValues = $this->safeContractArray($contract);
            $isDraft = $contract->status === ContractStatus::DRAFT;
            $type = $contract->type->value;

            // The number is generated per type, and the schedule shape depends on it: switching would
            // silently rewrite the whole deal. Cancel and re-create instead.
            if (array_key_exists('type', $data) && $data['type'] !== null && $data['type'] !== $type) {
                throw ValidationException::withMessages([
                    'type' => __('contracts.cannot_change_type'),
                ]);
            }

            $given = fn (string $key) => array_key_exists($key, $data);
            $value = fn (string $key, $fallback) => $given($key) ? $data[$key] : $fallback;

            $contractDate = $value('contract_date', $contract->contract_date);
            $totalPrice = round((float) $value('total_price', $contract->total_price), 2);
            $discount = round((float) $value('discount', $contract->discount), 2);
            $downPayment = round((float) $value('agreed_down_payment', $contract->agreed_down_payment), 2);
            $count = (int) $value('installments_count', $contract->installments_count);
            $interval = $value('interval_months', $contract->interval_months);
            $firstDate = $value('first_installment_date', $contract->first_installment_date);
            $monthlyRent = round((float) $value('monthly_rent', $contract->monthly_rent), 2);
            $duration = (int) $value('duration_months', $contract->duration_months);
            $startDate = $value('start_date', $contract->start_date);
            $endDate = $value('end_date', $contract->end_date);

            // A lease total follows its rent × term whenever the caller did not send one explicitly.
            if ($type === ContractType::RENT->value && ! $given('total_price')
                && ($given('monthly_rent') || $given('duration_months')) && $monthlyRent > 0 && $duration > 0) {
                $totalPrice = round($monthlyRent * $duration, 2);
            }

            // Same for the lease end date.
            if ($type === ContractType::RENT->value && ! $given('end_date') && ($given('start_date') || $given('duration_months'))) {
                $endDate = $this->leaseEndDate(['start_date' => $startDate, 'duration_months' => $duration]);
            }

            // ── Unit ────────────────────────────────────────────────────────────
            $oldUnitId = (int) $contract->unit_id;
            $unitId = $given('unit_id') ? (int) $data['unit_id'] : $oldUnitId;
            $unit = Unit::whereKey($unitId)->lockForUpdate()->first();

            if (! $unit) {
                throw ValidationException::withMessages([
                    'unit_id' => __('contracts.unit_not_found'),
                ]);
            }

            $this->assertUnitOfferedFor($unit, $type);

            if ($unitId !== $oldUnitId) {
                if ($unit->reservations()->where('status', ReservationStatus::ACTIVE->value)->exists()) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('contracts.unit_has_active_reservation'),
                    ]);
                }

                if (Contract::where('unit_id', $unitId)->whereKeyNot($contract->id)
                    ->whereIn('status', [ContractStatus::ACTIVE->value, ContractStatus::DRAFT->value])->exists()) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('contracts.unit_has_active_contract'),
                    ]);
                }

                // A contract born from a reservation stays in that reservation's building.
                $reservation = $contract->reservation;
                if ($reservation && $reservation->building_id
                    && (int) $reservation->building_id !== (int) $unit->building_id) {
                    throw ValidationException::withMessages([
                        'unit_id' => __('contracts.unit_not_in_reservation_building'),
                    ]);
                }
            }

            // ── Money floors of a posted contract ───────────────────────────────
            $paidDownPayment = 0.0;
            if (! $isDraft) {
                $paidDownPayment = (float) $contract->paid_down_payment;
                $installmentPaid = (float) $contract->installmentPayments()
                    ->where('status', PaymentStatus::VALID->value)
                    ->whereNull('deleted_at')
                    ->sum('amount');
                $collected = (float) MoneyCalculator::sumPayments([$paidDownPayment, $installmentPaid]);

                if ($downPayment < $paidDownPayment) {
                    throw ValidationException::withMessages([
                        'agreed_down_payment' => __('contracts.down_payment_less_than_paid'),
                    ]);
                }

                if ($totalPrice < $collected) {
                    throw ValidationException::withMessages([
                        'total_price' => __('contracts.cannot_edit_price_below_deposit'),
                    ]);
                }
            }

            if ($downPayment > $totalPrice) {
                throw ValidationException::withMessages([
                    'agreed_down_payment' => __('contracts.down_payment_exceeds_price'),
                ]);
            }

            // ── Schedule ────────────────────────────────────────────────────────
            $rows = array_key_exists('schedule', $data) ? $this->scheduleRows($data['schedule'] ?? []) : null;

            $shapeFields = ['total_price', 'discount', 'agreed_down_payment', 'installments_count',
                'first_installment_date', 'interval_months', 'monthly_rent', 'duration_months', 'start_date'];
            $shapeChanged = collect($shapeFields)->contains(fn (string $key) => $given($key));

            $lockedCount = $isDraft ? 0 : $contract->installments()->get()
                ->filter(fn (Installment $installment) => $this->isScheduleRowLocked($installment))
                ->count();

            if ($rows === null && $shapeChanged) {
                // Paid rows sit inside the old schedule; regenerating would not know where, so the
                // caller has to send the new schedule as a whole.
                if ($lockedCount > 0) {
                    throw ValidationException::withMessages([
                        'schedule' => __('contracts.schedule_required_for_paid_contract'),
                    ]);
                }

                $rows = $this->generatedRows([
                    'total_price' => $totalPrice,
                    'agreed_down_payment' => $downPayment,
                    'installments_count' => $count,
                    'first_installment_date' => $firstDate,
                    'interval_months' => $interval,
                    'monthly_rent' => $monthlyRent,
                    'duration_months' => $duration ?: null,
                    'start_date' => $startDate,
                    'contract_date' => $contractDate,
                ], $type, $totalPrice, $downPayment);
            }

            $installmentsCount = $isDraft ? 0 : (int) $contract->installments_count;
            $firstInstallmentDate = $isDraft ? null : $contract->first_installment_date;
            $draftSchedule = null;

            if ($rows !== null) {
                if ($isDraft) {
                    $draftSchedule = array_map(fn (array $row) => [
                        'due_date' => $row['due_date'],
                        'amount' => $row['amount'],
                        'is_down_payment' => $row['is_down_payment'],
                        'paid_amount' => $row['paid_amount'],
                    ], $rows);
                } else {
                    $planned = $this->replanSchedule($contract, $rows);
                    $installmentsCount = count($planned);
                    $firstInstallmentDate = $planned ? min(array_column($planned, 'due_date')) : null;
                }
            }

            $fields = [
                'client_id' => $value('client_id', $contract->client_id),
                'unit_id' => $unitId,
                'contract_date' => $contractDate,
                'total_price' => $totalPrice,
                'discount' => $discount,
                'discount_reason' => $value('discount_reason', $contract->discount_reason),
                'agreed_down_payment' => $downPayment,
                'installments_count' => $installmentsCount,
                'first_installment_date' => $firstInstallmentDate,
                'interval_months' => $interval,
                'monthly_rent' => $monthlyRent,
                'duration_months' => $duration ?: null,
                'start_date' => $startDate,
                'end_date' => $endDate,
                'security_deposit' => round((float) $value('security_deposit', $contract->security_deposit), 2),
                'advance_months' => (int) $value('advance_months', $contract->advance_months),
                'annual_increase_pct' => $value('annual_increase_pct', $contract->annual_increase_pct),
                'increase_from_year' => $value('increase_from_year', $contract->increase_from_year),
                'notes' => $value('notes', $contract->notes),
            ];

            if ($isDraft && $rows !== null) {
                $fields['draft_schedule'] = $draftSchedule;
            }

            Contract::$allowFinancialUpdate = true;
            try {
                $contract->update($fields);
            } finally {
                Contract::$allowFinancialUpdate = false;
            }

            // ── Unit statuses follow the contract ───────────────────────────────
            if (! $isDraft && $unitId !== $oldUnitId) {
                $oldUnitStillHeld = Contract::where('unit_id', $oldUnitId)->whereKeyNot($contract->id)
                    ->whereIn('status', [ContractStatus::ACTIVE->value, ContractStatus::DRAFT->value])->exists()
                    || Reservation::where('unit_id', $oldUnitId)
                        ->where('status', ReservationStatus::ACTIVE->value)->exists();

                if (! $oldUnitStillHeld) {
                    Unit::whereKey($oldUnitId)->update(['status' => UnitStatus::AVAILABLE->value]);
                }

                $unit->update([
                    'status' => $type === ContractType::SALE->value
                        ? UnitStatus::SOLD->value
                        : UnitStatus::RENTED->value,
                ]);
            }

            $contract = $contract->fresh();
            $newValues = $this->safeContractArray($contract);

            $this->audit->log(
                action: AuditAction::UPDATE->value,
                entityType: 'contracts',
                entityId: $contract->id,
                oldValues: $oldValues,
                newValues: $newValues,
                changedFields: array_keys(array_filter(
                    $newValues,
                    fn ($value, $key) => ($oldValues[$key] ?? null) != $value,
                    ARRAY_FILTER_USE_BOTH
                )),
                isAutomatic: false,
                reason: 'Contract edited by '.$actor->name,
            );

            return $contract->load(
                'client',
                'unit.building',
                'reservation',
                'installments',
                'downPayments',
                'installmentPayments'
            );
        });
    }

    /** Caller rows for an edit: like explicitRows(), but it remembers which installment it carries. */
    private function scheduleRows(array $rows): array
    {
        return collect($rows)
            ->filter(fn ($row) => ! empty($row['due_date']) && (float) ($row['amount'] ?? 0) > 0)
            ->map(fn ($row) => [
                'installment_id' => ! empty($row['installment_id']) ? (int) $row['installment_id'] : null,
                'due_date' => Carbon::parse($row['due_date'])->toDateString(),
                'amount' => round((float) $row['amount'], 2),
                'is_down_payment' => (bool) ($row['is_down_payment'] ?? false),
                'paid_amount' => round((float) ($row['paid_amount'] ?? 0), 2),
            ])
            ->values()
            ->all();
    }

    /**
     * Re-plan a posted schedule around the rows that already hold money.
     *
     * A row is locked when it collected something (`paid_amount > 0`). Locked rows keep their amount
     * and due date; the sent rows only re-plan the free ones. A free row missing from the new schedule
     * is deleted, just as a fresh schedule would never have created it — unless a (cancelled) payment
     * line still points at it.
     *
     * @return array<int, array{due_date: string, amount: float}> the final schedule
     */
    private function replanSchedule(Contract $contract, array $rows): array
    {
        $existing = $contract->installments()->orderBy('sequence_number')->get()->keyBy('id');
        $locked = [];
        $open = [];

        foreach ($existing as $id => $installment) {
            if ($this->isScheduleRowLocked($installment)) {
                $locked[$id] = $installment;
            } else {
                $open[$id] = $installment;
            }
        }

        $final = [];
        $seen = [];

        foreach ($rows as $row) {
            $id = $row['installment_id'];

            // The same existing row twice would move one installment while counting two.
            if ($id !== null && isset($seen[$id])) {
                continue;
            }

            // A paid row never moves, whatever the caller sent for it.
            if ($id !== null && isset($locked[$id])) {
                $seen[$id] = true;
                $final[] = [
                    'installment' => $locked[$id],
                    'due_date' => $locked[$id]->due_date->toDateString(),
                    'amount' => (float) $locked[$id]->amount,
                ];

                continue;
            }

            if ($id !== null && isset($open[$id])) {
                $seen[$id] = true;
            }

            $final[] = [
                'installment' => $id !== null ? ($open[$id] ?? null) : null,
                'due_date' => $row['due_date'],
                'amount' => round((float) $row['amount'], 2),
            ];
        }

        // Paid rows the caller left out stay exactly where they are.
        foreach ($locked as $id => $installment) {
            if (! isset($seen[$id])) {
                $final[] = [
                    'installment' => $installment,
                    'due_date' => $installment->due_date->toDateString(),
                    'amount' => (float) $installment->amount,
                ];
            }
        }

        // Free rows dropped from the schedule go away — unless a payment line points at them.
        foreach ($open as $id => $installment) {
            if (isset($seen[$id])) {
                continue;
            }

            if ($installment->payments()->exists()) {
                throw ValidationException::withMessages([
                    'schedule' => __('contracts.schedule_shrink_blocked'),
                ]);
            }

            $installment->delete();
        }

        // Sequence follows the due date, so the statement still reads like a calendar.
        usort($final, fn (array $a, array $b) => [
            $a['due_date'], $a['installment']?->id ?? PHP_INT_MAX,
        ] <=> [
            $b['due_date'], $b['installment']?->id ?? PHP_INT_MAX,
        ]);

        $sequence = 0;
        $result = [];

        foreach ($final as $row) {
            $sequence++;
            $installment = $row['installment'];
            $dueDate = $row['due_date'];
            $amount = round((float) $row['amount'], 2);
            $result[] = ['due_date' => $dueDate, 'amount' => $amount];

            if (! $installment) {
                Installment::create([
                    'contract_id' => $contract->id,
                    'sequence_number' => $sequence,
                    'due_date' => $dueDate,
                    'amount' => $amount,
                    'paid_amount' => 0,
                    'remaining' => $amount,
                    'status' => InstallmentStatus::DUE->value,
                ]);

                continue;
            }

            $changes = [];

            if ($installment->sequence_number !== $sequence) {
                $changes['sequence_number'] = $sequence;
            }

            if (! $this->isScheduleRowLocked($installment)) {
                if ($installment->due_date->toDateString() !== $dueDate) {
                    $changes['due_date'] = $dueDate;
                }

                if (abs((float) $installment->amount - $amount) >= 0.005) {
                    $changes['amount'] = $amount;
                    $changes['remaining'] = round($amount - (float) $installment->paid_amount, 2);
                    $changes['status'] = $installment->isCancelled()
                        ? InstallmentStatus::CANCELLED->value
                        : InstallmentStatus::DUE->value;
                }
            }

            if ($changes) {
                $installment->update($changes);
            }
        }

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'contracts',
            entityId: $contract->id,
            newValues: [
                'installments_count' => count($result),
                'total_amount' => round(array_sum(array_column($result, 'amount')), 2),
            ],
            isAutomatic: true,
            reason: 'Installments re-planned for contract #'.$contract->number,
        );

        return $result;
    }

    /**
     * A row is frozen once it collected money. A row that only carries cancelled payment lines has
     * `paid_amount = 0` and may still be re-planned — but it can never be dropped, because that
     * history points at it (see replanSchedule()).
     */
    private function isScheduleRowLocked(Installment $installment): bool
    {
        return (float) $installment->paid_amount > 0;
    }

    /**
     * A sale contract needs a unit that offers sale and is on the market; a rent contract needs the same
     * for rent. «غير قابلة للبيع» blocks both.
     */
    private function assertUnitOfferedFor(Unit $unit, string $type): void
    {
        $isSale = $type === ContractType::SALE->value;

        if (! $unit->is_sellable) {
            throw ValidationException::withMessages([
                'unit_id' => __('units.not_available'),
            ]);
        }

        if ($isSale && ! $unit->offersSale()) {
            throw ValidationException::withMessages([
                'unit_id' => __('units.purpose_rent_only'),
            ]);
        }

        if (! $isSale && ! $unit->offersRent()) {
            throw ValidationException::withMessages([
                'unit_id' => __('units.purpose_sale_only'),
            ]);
        }
    }

    /** The caller's own rows (`schedule[]`), normalised; empty when it sent none. */
    private function explicitRows(array $data): array
    {
        return collect($data['schedule'] ?? [])
            ->filter(fn ($row) => ! empty($row['due_date']) && (float) ($row['amount'] ?? 0) > 0)
            ->map(fn ($row) => [
                'due_date' => Carbon::parse($row['due_date'])->toDateString(),
                'amount' => round((float) $row['amount'], 2),
                'is_down_payment' => (bool) ($row['is_down_payment'] ?? false),
                'paid_amount' => round((float) ($row['paid_amount'] ?? 0), 2),
            ])
            ->values()
            ->all();
    }

    private function regularRows(array $rows): array
    {
        return array_values(array_filter($rows, fn ($row) => empty($row['is_down_payment'])));
    }

    private function firstDate(array $rows): ?string
    {
        $dates = array_column($this->regularRows($rows), 'due_date');
        sort($dates);

        return $dates[0] ?? null;
    }

    /**
     * Sale: the price is agreed on the contract. Rent: the price may be omitted and is then the total
     * of the schedule (or rent x months).
     */
    private function resolveTotalPrice(array $data, string $type, array $explicitRows): float
    {
        if (isset($data['total_price']) && (float) $data['total_price'] > 0) {
            return round((float) $data['total_price'], 2);
        }

        $sum = round(array_sum(array_column($this->regularRows($explicitRows), 'amount')), 2);

        if ($type === ContractType::SALE->value) {
            if ($sum > 0) {
                return $sum;
            }

            throw ValidationException::withMessages([
                'total_price' => __('contracts.price_required_for_sale'),
            ]);
        }

        if ($sum > 0) {
            return $sum;
        }

        $rent = (float) ($data['monthly_rent'] ?? 0);
        $months = (int) ($data['duration_months'] ?? 0);

        if ($rent > 0 && $months > 0) {
            return round($rent * $months, 2);
        }

        throw ValidationException::withMessages([
            'total_price' => __('contracts.rent_total_required'),
        ]);
    }

    /** Rows when the caller sent none: the classic equal split, or one row per lease month. */
    private function generatedRows(array $data, string $type, float $totalPrice, float $downPayment): array
    {
        $count = (int) ($data['installments_count'] ?? 0);

        if ($count > 0) {
            if (empty($data['first_installment_date'])) {
                throw ValidationException::withMessages([
                    'first_installment_date' => __('contracts.start_date_required_for_installments'),
                ]);
            }
            if (empty($data['interval_months'])) {
                throw ValidationException::withMessages([
                    'interval_months' => __('contracts.interval_required_for_installments'),
                ]);
            }
            if ($count > 360) {
                throw ValidationException::withMessages([
                    'installments_count' => __('contracts.max_installments_exceeded'),
                ]);
            }

            return $this->equalRows(
                round($totalPrice - $downPayment, 2),
                $count,
                (int) $data['interval_months'],
                Carbon::parse($data['first_installment_date'])
            );
        }

        $rent = (float) ($data['monthly_rent'] ?? 0);
        $months = (int) ($data['duration_months'] ?? 0);
        if ($type === ContractType::RENT->value && $rent > 0 && $months > 0) {
            return $this->monthlyRentRows(
                $rent,
                $months,
                Carbon::parse($data['start_date'] ?? $data['contract_date'])
            );
        }

        return [];
    }

    /** Equal amounts, the last one absorbs the rounding. */
    private function equalRows(float $remainder, int $count, int $interval, Carbon $startDate): array
    {
        $base = floor(($remainder / max(1, $count)) * 100) / 100;
        $rows = [];
        $left = $remainder;

        for ($i = 1; $i <= $count; $i++) {
            $dueDate = $this->addMonthsClamped($startDate, ($i - 1) * $interval);
            $amount = $i === $count ? round($left, 2) : round($base, 2);
            $left = round($left - $base, 2);

            $rows[] = [
                'due_date' => $dueDate->toDateString(),
                'amount' => $amount,
                'is_down_payment' => false,
                'paid_amount' => 0.0,
            ];
        }

        return $rows;
    }

    /** One row per lease month, starting on the start date. */
    private function monthlyRentRows(float $rent, int $months, Carbon $startDate): array
    {
        $rows = [];
        for ($i = 0; $i < $months; $i++) {
            $rows[] = [
                'due_date' => $this->addMonthsClamped($startDate, $i)->toDateString(),
                'amount' => round($rent, 2),
                'is_down_payment' => false,
                'paid_amount' => 0.0,
            ];
        }

        return $rows;
    }

    /** Month-end handling: if the start day doesn't exist in a later month, use the last day of that month. */
    private function addMonthsClamped(Carbon $start, int $months): Carbon
    {
        $dueDate = $start->copy()->addMonthsNoOverflow($months);

        return $dueDate;
    }

    private function leaseEndDate(array $data): ?string
    {
        $months = (int) ($data['duration_months'] ?? 0);
        if ($months < 1 || empty($data['start_date'])) {
            return null;
        }

        return $this->addMonthsClamped(Carbon::parse($data['start_date']), $months - 1)->toDateString();
    }

    /**
     * Write the schedule: installments for the regular rows, plus the payments the caller marked as
     * collected at signing (a down-payment row becomes a down-payment payment; a paid row becomes an
     * installment payment).
     */
    private function writeSchedule(Contract $contract, array $rows, $actor): void
    {
        $sequence = 0;

        foreach ($rows as $row) {
            $amount = round((float) $row['amount'], 2);

            if (! empty($row['is_down_payment'])) {
                if (($row['paid_amount'] ?? 0) > 0) {
                    ContractDownPayment::create([
                        'contract_id' => $contract->id,
                        'amount' => min(round((float) $row['paid_amount'], 2), (float) $contract->agreed_down_payment),
                        'paid_at' => $contract->contract_date,
                        'payment_method' => null,
                        'status' => PaymentStatus::VALID->value,
                        'created_by' => $actor->id,
                    ]);
                }

                continue;
            }

            $sequence++;
            $installment = Installment::create([
                'contract_id' => $contract->id,
                'sequence_number' => $sequence,
                'due_date' => $row['due_date'],
                'amount' => $amount,
                'paid_amount' => 0,
                'remaining' => $amount,
                'status' => InstallmentStatus::DUE->value,
            ]);

            if (($row['paid_amount'] ?? 0) > 0) {
                $this->installments->recordPayment($contract->id, $installment->id, [
                    'amount' => min(round((float) $row['paid_amount'], 2), $amount),
                    'paid_at' => $contract->contract_date,
                    'payment_method' => null,
                ], $actor);
            }
        }

        if ($sequence > 0) {
            $this->audit->log(
                action: AuditAction::UPDATE->value,
                entityType: 'contracts',
                entityId: $contract->id,
                newValues: [
                    'installments_count' => $sequence,
                    'total_amount' => round(array_sum(array_column($this->regularRows($rows), 'amount')), 2),
                ],
                isAutomatic: true,
                reason: 'Installments generated for contract #'.$contract->number,
            );
        }
    }

    /** Sell/rent the unit and mark the reservation converted — the side effects of posting a contract. */
    private function completeOperation(Contract $contract, ?Reservation $reservation): void
    {
        if ($reservation) {
            $reservation->update(['status' => 'converted']);
        }

        $unit = Unit::find($contract->unit_id);
        if ($unit) {
            $unit->update([
                'status' => $contract->type === ContractType::SALE
                    ? UnitStatus::SOLD->value
                    : UnitStatus::RENTED->value,
            ]);
        }
    }

    /**
     * Generate contract number sequential per year, race-safe.
     */
    private function generateContractNumber(string $type, string $date): string
    {
        $year = Carbon::parse($date)->year;
        $prefix = $year.'-';

        return DB::transaction(function () use ($prefix) {
            $max = Contract::where('number', 'like', $prefix.'%')
                ->lockForUpdate()
                ->max('number');

            $next = 1;
            if ($max) {
                $next = (int) substr($max, strlen($prefix)) + 1;
            }

            return $prefix.str_pad($next, 4, '0', STR_PAD_LEFT);
        });
    }

    public function cancel(Contract $contract, string $reason, $actor): Contract
    {
        if (! $contract->isActive() && $contract->status !== ContractStatus::DRAFT) {
            throw ValidationException::withMessages([
                'contract' => __('contracts.cannot_cancel_non_active'),
            ]);
        }

        return DB::transaction(function () use ($contract, $reason) {
            $wasDraft = $contract->status === ContractStatus::DRAFT;
            $oldValues = $this->safeContractArray($contract);

            $contract->update([
                'status' => ContractStatus::CANCELLED,
                'cancelled_at' => $this->operation->now(),
                'cancellation_reason' => $reason,
            ]);

            // Cancel all installments (not delete)
            $contract->installments()->update(['status' => InstallmentStatus::CANCELLED->value]);

            // A draft never touched the unit; an active contract frees it.
            if (! $wasDraft) {
                $unit = Unit::find($contract->unit_id);
                $unit?->update(['status' => UnitStatus::AVAILABLE]);
            }

            // If from reservation, reservation stays converted (per brief - money fate is unconfirmed)

            $this->audit->log(
                action: AuditAction::CANCEL->value,
                entityType: 'contracts',
                entityId: $contract->id,
                oldValues: $oldValues,
                newValues: $this->safeContractArray($contract),
                changedFields: ['status', 'cancelled_at', 'cancellation_reason'],
                reason: 'Contract cancelled: '.$reason,
            );

            return $contract->fresh();
        });
    }

    private function safeContractArray(Contract $c): array
    {
        return [
            'id' => $c->id,
            'number' => $c->number,
            'type' => $c->type?->value,
            'client_id' => $c->client_id,
            'unit_id' => $c->unit_id,
            'contract_date' => $c->contract_date,
            'total_price' => $c->total_price,
            'discount' => $c->discount,
            'agreed_down_payment' => $c->agreed_down_payment,
            'installments_count' => $c->installments_count,
            'first_installment_date' => $c->first_installment_date,
            'interval_months' => $c->interval_months,
            'monthly_rent' => $c->monthly_rent,
            'duration_months' => $c->duration_months,
            'status' => $c->status?->value,
        ];
    }
}
