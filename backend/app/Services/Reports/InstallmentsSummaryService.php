<?php

namespace App\Services\Reports;

use App\Enums\ContractStatus;
use App\Enums\ContractType;
use App\Models\Contract;
use Illuminate\Database\Eloquent\Builder;

/**
 * «ملخص الأقساط والعقود»: one row per non-draft contract (sale or lease) with the schedule rollup
 * the report shows — the money totals, how many rows are collected, the last collected row and the
 * row still owed. Read-only; money changes only through receipts.
 */
class InstallmentsSummaryService extends BaseReportService
{
    /**
     * @param  string|null  $type  `sale` / `rent`; null = both
     * @param  string|null  $status  `active` / `cancelled`; null = both (drafts are never listed)
     * @return array{data: array<int, array<string, mixed>>, meta: array<string, mixed>}
     */
    public function generate(
        ?string $type = null,
        ?int $buildingId = null,
        ?int $clientId = null,
        ?string $status = null,
    ): array {
        // A draft has no schedule yet (it lives in draft_schedule), so it has nothing to summarise.
        $scope = Contract::query()
            ->whereIn('contracts.status', [ContractStatus::ACTIVE->value, ContractStatus::CANCELLED->value])
            ->when($buildingId, fn (Builder $q) => $q->whereHas('unit', fn (Builder $u) => $u->where('building_id', $buildingId)))
            ->when($clientId, fn (Builder $q) => $q->where('contracts.client_id', $clientId))
            ->when($status, fn (Builder $q) => $q->where('contracts.status', $status));

        // The type chips are counted before the type filter, like the contracts and collection pages.
        $counts = (clone $scope)->toBase()
            ->selectRaw(
                "COUNT(*) as all_count,
                SUM(CASE WHEN contracts.type = ? THEN 1 ELSE 0 END) as sale_count,
                SUM(CASE WHEN contracts.type = ? THEN 1 ELSE 0 END) as rent_count",
                [ContractType::SALE->value, ContractType::RENT->value]
            )
            ->first();

        $contracts = (clone $scope)
            ->when($type, fn (Builder $q) => $q->where('contracts.type', $type))
            ->with(['client', 'unit.building', 'reservation.payments', 'downPayments', 'lastPaidInstallment', 'firstOpenInstallment'])
            ->withCount('installments as total_installments')
            ->withCount(['installments as paid_installments' => fn (Builder $q) => $q->where('remaining', '<=', 0)])
            ->withSum('installments as installments_total', 'amount')
            ->withSum('installments as installments_paid', 'paid_amount')
            ->withSum('installments as installments_remaining', 'remaining')
            ->orderBy('contracts.number')
            ->get();

        $rows = $contracts->map(fn (Contract $contract) => $this->row($contract))->all();

        $this->logReportAccess('installments_summary', [
            'type' => $type,
            'building_id' => $buildingId,
            'client_id' => $clientId,
            'status' => $status,
            'contracts' => count($rows),
        ]);

        return [
            'data' => $rows,
            'meta' => [
                'total' => count($rows),
                'counts' => [
                    'all' => (int) ($counts->all_count ?? 0),
                    'sale' => (int) ($counts->sale_count ?? 0),
                    'rent' => (int) ($counts->rent_count ?? 0),
                ],
            ],
        ];
    }

    /** One contract, flattened into the columns the report table shows. */
    private function row(Contract $contract): array
    {
        $isRent = $contract->type === ContractType::RENT;

        $installmentsTotal = $this->amount($contract->installments_total);
        $installmentsPaid = $this->amount($contract->installments_paid);
        $installmentsRemaining = $this->amount($contract->installments_remaining);

        $agreedDown = $isRent ? 0.0 : $this->amount($contract->agreed_down_payment);
        // Reservation deposit + valid down-payment receipts (the Contract accessor reads both).
        $paidDown = $this->amount($contract->paid_down_payment);
        $downRemaining = max(0.0, round($agreedDown - $paidDown, 2));

        $securityDeposit = $isRent ? $this->amount($contract->security_deposit) : 0.0;
        $depositRemaining = $isRent ? max(0.0, round($securityDeposit - $paidDown, 2)) : 0.0;

        // Sale: the agreed price; lease: the whole schedule (rent over the term).
        $contractValue = $isRent ? $installmentsTotal : $this->amount($contract->total_price);
        $totalPaid = $isRent ? $installmentsPaid : round($paidDown + $installmentsPaid, 2);
        $totalRemaining = $isRent
            ? $installmentsRemaining
            : round($downRemaining + $installmentsRemaining, 2);

        return [
            'id' => $contract->id,
            'number' => $contract->number,
            'type' => $contract->type?->value,
            'status' => $contract->status?->value,
            'status_label' => $contract->status?->label(),
            'client_id' => $contract->client_id,
            'client_name' => $contract->client?->name,
            'building_id' => $contract->unit?->building_id,
            'building_name' => $contract->unit?->building?->name,
            'unit_name' => $contract->unit?->name,
            'contract_date' => $contract->contract_date?->toDateString(),

            // Sale price / lease rent + term.
            'unit_price' => $isRent ? 0.0 : $this->amount($contract->total_price),
            'monthly_rent' => $isRent ? $this->amount($contract->monthly_rent) : 0.0,
            'security_deposit' => $securityDeposit,
            'start_date' => $isRent ? $contract->start_date?->toDateString() : null,
            'end_date' => $isRent ? $contract->end_date?->toDateString() : null,

            // Upfront amount: a sale's down payment or a lease's deposit.
            'down_payment' => $agreedDown,
            'down_payment_remaining' => $downRemaining,
            'deposit_remaining' => $depositRemaining,
            'upfront_remaining' => $isRent ? $depositRemaining : $downRemaining,

            'total_installments' => (int) $contract->total_installments,
            'paid_installments' => (int) $contract->paid_installments,
            'installments_total' => $installmentsTotal,
            'installments_paid' => $installmentsPaid,
            'installments_remaining' => $installmentsRemaining,
            'contract_value' => $contractValue,
            'total_paid' => $totalPaid,
            'total_remaining' => $totalRemaining,
            'current_installment_remaining' => $this->amount($contract->firstOpenInstallment?->remaining),

            'last_paid_installment' => $this->installmentRef($contract->lastPaidInstallment),
            'next_due_installment' => $this->installmentRef($contract->firstOpenInstallment),
        ];
    }

    /** Only what the report prints: the row number and its due date. */
    private function installmentRef($installment): ?array
    {
        if (! $installment) {
            return null;
        }

        return [
            'sequence_number' => (int) $installment->sequence_number,
            'due_date' => $installment->due_date?->toDateString(),
        ];
    }

    private function amount(mixed $value): float
    {
        return round((float) ($value ?? 0), 2);
    }
}
