<?php

namespace App\Services\Reports;

use App\Enums\ContractStatus;
use App\Enums\ContractType;
use App\Enums\InstallmentStatus;
use App\Enums\PaymentStatus;
use App\Models\Contract;
use App\Models\Installment;
use App\Models\Reservation;
use App\Models\Unit;
use Carbon\Carbon;

/**
 * «كشف وحدة»: one unit — its data, the reservations and contracts it went through (whole history,
 * the screen has no period of its own), the schedule of the current contract, and the money rollup
 * of the active contract. Read-only.
 */
class UnitStatementService extends BaseReportService
{
    public function generate(int $unitId, string $fromDate, string $toDate): array
    {
        $today = Carbon::today();

        $unit = Unit::with(['building', 'floor'])->findOrFail($unitId);

        // Drafts have no schedule (it lives in `draft_schedule`), so they are not part of a statement.
        $contracts = Contract::query()
            ->where('unit_id', $unitId)
            ->whereIn('contracts.status', [ContractStatus::ACTIVE->value, ContractStatus::CANCELLED->value])
            ->with(['client', 'installments.payments', 'reservation.payments', 'downPayments'])
            ->orderBy('contract_date')
            ->orderBy('id')
            ->get();

        $reservations = Reservation::query()
            ->where('unit_id', $unitId)
            ->with('client')
            ->orderBy('reservation_date')
            ->orderBy('id')
            ->get();

        $contractRows = $contracts
            ->map(fn (Contract $contract) => $this->contractRow($contract, $today))
            ->all();
        $reservationRows = $reservations
            ->map(fn (Reservation $reservation) => $this->reservationRow($reservation))
            ->all();

        // What the screen shows as «the current contract»: the active one (a unit has at most one).
        $current = $contracts->first(fn (Contract $c) => $c->status === ContractStatus::ACTIVE);
        $currentRow = null;
        foreach ($contractRows as $row) {
            if ($current !== null && $row['id'] === $current->id) {
                $currentRow = $row;
                break;
            }
        }

        $currentReservation = $reservations->first(fn (Reservation $r) => $r->isActive());
        $client = $current?->client ?? $currentReservation?->client;

        $totals = [
            'sales' => 0.0,
            'paid' => 0.0,
            'remaining' => 0.0,
            'due' => 0.0,
            'overdue' => 0.0,
            'monthly_rent' => 0.0,
            'deposit_paid' => 0.0,
        ];
        foreach ($contractRows as $row) {
            if (! $row['is_active']) {
                continue;
            }
            $totals['sales'] += $row['type'] === ContractType::SALE->value ? $row['value'] : 0.0;
            $totals['paid'] += $row['paid'];
            $totals['remaining'] += $row['remaining'];
            $totals['due'] += $row['due'];
            $totals['overdue'] += $row['overdue'];
            $totals['monthly_rent'] += $row['monthly_rent'];
        }
        // The deposit follows the reservation it was paid on, even once it became a contract.
        // A converted reservation's deposit already sits in the contract's paid down payment, so the
        // card only shows the deposit of the reservation that is still open.
        $totals['deposit_paid'] = $currentReservation === null ? 0.0 : $this->amount($currentReservation->deposit_paid);
        foreach (array_keys($totals) as $field) {
            $totals[$field] = $this->amount($totals[$field]);
        }

        $this->logReportAccess('unit_statement', [
            'unit_id' => $unitId,
            'from_date' => $fromDate,
            'to_date' => $toDate,
        ]);

        return [
            'unit' => [
                'id' => $unit->id,
                'name' => $unit->name,
                'type' => $unit->type?->value,
                'type_label' => $unit->type?->label(),
                'status' => $unit->status?->value,
                'status_label' => $unit->status?->label(),
                'is_sellable' => (bool) $unit->is_sellable,
                'non_sellable_reason' => $unit->non_sellable_reason,
                'purpose' => $unit->purpose?->value,
                'purpose_label' => $unit->purpose?->label(),
                'area' => $this->amount($unit->area),
                'price_per_meter' => $unit->price_per_meter === null ? null : $this->amount($unit->price_per_meter),
                'sale_price' => $unit->sale_price === null ? null : $this->amount($unit->sale_price),
                'total_price' => $unit->total_price === null ? null : $this->amount($unit->total_price),
                'rooms' => $unit->rooms,
                'bathrooms' => $unit->bathrooms,
                'floor' => $unit->floor?->floor_number,
                'floor_display_name' => $unit->floor?->display_name,
                'building_id' => $unit->building_id,
                'building_name' => $unit->building?->name,
                'building_city' => $unit->building?->city,
                'building_district' => $unit->building?->district,
            ],
            'period' => [
                'from' => $fromDate,
                'to' => $toDate,
            ],
            'client' => $client === null ? null : [
                'id' => $client->id,
                'name' => $client->name,
                'phone' => $client->phone,
                'phone_2' => $client->phone_2,
                'national_id' => $client->national_id,
            ],
            'current_contract' => $currentRow,
            'current_reservation' => $currentReservation === null ? null : $this->reservationRow($currentReservation),
            'reservations' => $reservationRows,
            'contracts' => $contractRows,
            'totals' => $totals,
        ];
    }

    /**
     * One contract of the unit's history: its terms, money rollup and schedule.
     *
     * @return array<string, mixed>
     */
    private function contractRow(Contract $contract, Carbon $today): array
    {
        $money = $this->contractMoney($contract, $today);
        $isRent = $money['is_rent'];

        return [
            'id' => $contract->id,
            'number' => $contract->number,
            'type' => $contract->type?->value,
            'type_label' => $contract->type?->label(),
            'status' => $contract->status?->value,
            'status_label' => $contract->status?->label(),
            'is_active' => $contract->status === ContractStatus::ACTIVE,
            'is_cancelled' => $contract->status === ContractStatus::CANCELLED,
            'contract_date' => $contract->contract_date?->toDateString(),
            'client_id' => $contract->client_id,
            'client_name' => $contract->client?->name,
            'client_phone' => $contract->client?->phone,
            'reservation_id' => $contract->reservation_id,
            'unit_price' => $isRent ? 0.0 : $this->amount($contract->total_price),
            'discount' => $this->amount($contract->discount),
            'down_payment' => $money['down_payment'],
            'down_payment_paid' => $money['down_payment_paid'],
            'down_payment_remaining' => $money['down_payment_remaining'],
            'monthly_rent' => $isRent ? $this->amount($contract->monthly_rent) : 0.0,
            'security_deposit' => $isRent ? $this->amount($contract->security_deposit) : 0.0,
            'duration_months' => $isRent ? $contract->duration_months : null,
            'start_date' => $isRent ? $contract->start_date?->toDateString() : null,
            'end_date' => $isRent ? $contract->end_date?->toDateString() : null,
            'value' => $money['value'],
            'paid' => $money['paid'],
            'remaining' => $money['remaining'],
            'overdue' => $money['overdue'],
            'due' => $money['due'],
            'installments_total' => $money['installments_total'],
            'installments_paid' => $money['installments_paid'],
            'installments_remaining' => $money['installments_remaining'],
            'installments_count' => $money['rows_count'],
            'paid_installments' => $money['paid_count'],
            'installments' => $contract->installments
                ->sortBy('sequence_number')
                ->map(fn (Installment $installment) => $this->installmentRow($installment, $today))
                ->values()
                ->all(),
        ];
    }

    /** One schedule row, with the day it was last collected on (cancelled receipts do not count). */
    private function installmentRow(Installment $installment, Carbon $today): array
    {
        $cancelled = $installment->status === InstallmentStatus::CANCELLED;
        $paidAt = $installment->relationLoaded('payments')
            ? $installment->payments
                ->filter(fn ($p) => $p->status === PaymentStatus::VALID && $p->deleted_at === null)
                ->max(fn ($p) => $p->paid_at?->toDateString())
            : null;

        return [
            'id' => $installment->id,
            'sequence_number' => (int) $installment->sequence_number,
            'due_date' => $installment->due_date?->toDateString(),
            'amount' => $this->amount($installment->amount),
            'paid_amount' => $this->amount($installment->paid_amount),
            'remaining' => $this->amount($installment->remaining),
            'status' => $installment->status?->value,
            'is_cancelled' => $cancelled,
            'is_overdue' => ! $cancelled && $this->amount($installment->remaining) > 0
                && $installment->due_date !== null && $installment->due_date->lt($today),
            'paid_at' => $paidAt,
        ];
    }

    /** @return array<string, mixed> */
    private function reservationRow(Reservation $reservation): array
    {
        return [
            'id' => $reservation->id,
            'client_id' => $reservation->client_id,
            'client_name' => $reservation->client?->name,
            'client_phone' => $reservation->client?->phone,
            'reservation_date' => $reservation->reservation_date?->toDateString(),
            'status' => $reservation->status?->value,
            'status_label' => $reservation->status?->label(),
            'deposit_paid' => $this->amount($reservation->deposit_paid),
            'cancelled_at' => $reservation->cancelled_at?->toDateString(),
            'cancellation_reason' => $reservation->cancellation_reason,
        ];
    }

    private function amount(mixed $value): float
    {
        return round((float) ($value ?? 0), 2);
    }
}
