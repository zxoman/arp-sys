<?php

namespace App\Services\Reports;

use App\Enums\ContractStatus;
use App\Models\Installment;
use App\Support\Money\MoneyCalculator;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;

/**
 * «الأقساط المستحقة والمتأخرة» (aging): every unpaid installment of an active contract that is due
 * today or already past due, grouped into delay buckets (0-30 / 31-60 / 61-90 / +90 days). Read-only;
 * the money is only collected through receipts.
 */
class DueOverdueReportService extends BaseReportService
{
    /** Delay buckets, in the order the report shows them. */
    public const BUCKETS = ['0-30', '31-60', '61-90', '90+'];

    /**
     * @param  string|null  $type  `sale` / `rent`; null = both
     * @param  string|null  $bucket  one of `self::BUCKETS`; null = every bucket
     * @return array{data: array<int, array<string, mixed>>, meta: array<string, mixed>}
     */
    public function generate(
        ?string $type = null,
        ?int $buildingId = null,
        ?int $clientId = null,
        ?string $bucket = null,
    ): array {
        $today = Carbon::today();

        $rows = $this->scope($today, $type, $buildingId, $clientId)
            ->with('contract.client', 'contract.unit.building')
            ->orderBy('installments.due_date')
            ->orderBy('installments.id')
            ->get()
            ->map(fn (Installment $installment) => $this->row($installment, $today))
            ->all();

        // The chips count every bucket of the current scope, so picking one never rewrites its own numbers.
        $buckets = ['all' => $this->rollup($rows)];
        foreach (self::BUCKETS as $key) {
            $buckets[$key] = $this->rollup(array_values(array_filter($rows, fn (array $row) => $row['bucket'] === $key)));
        }

        $filtered = $bucket !== null && in_array($bucket, self::BUCKETS, true)
            ? array_values(array_filter($rows, fn (array $row) => $row['bucket'] === $bucket))
            : $rows;

        $this->logReportAccess('due_overdue', [
            'type' => $type,
            'building_id' => $buildingId,
            'client_id' => $clientId,
            'bucket' => $bucket,
            'installments' => count($filtered),
        ]);

        return [
            'data' => $filtered,
            'meta' => [
                'total' => count($filtered),
                'buckets' => $buckets,
                // Not an aging figure: what falls due in the coming week, for the «يستحق خلال 7 أيام» card.
                'due_within_7_days' => $this->dueWithinSevenDays($today, $type, $buildingId, $clientId),
            ],
        ];
    }

    /** Unpaid rows of active contracts, due today or earlier, narrowed by the report filters. */
    private function scope(Carbon $today, ?string $type, ?int $buildingId, ?int $clientId): Builder
    {
        return Installment::query()
            ->whereHas('contract', fn (Builder $q) => $q->where('contracts.status', ContractStatus::ACTIVE->value))
            // `whereDate`, not `<=`: SQLite stores the cast date as `Y-m-d H:i:s`, so a plain string
            // comparison would silently drop the rows due exactly today.
            ->whereDate('installments.due_date', '<=', $today->toDateString())
            ->where('installments.remaining', '>', 0)
            ->when($type, fn (Builder $q) => $q->whereHas('contract', fn (Builder $c) => $c->where('contracts.type', $type)))
            ->when($clientId, fn (Builder $q) => $q->whereHas('contract', fn (Builder $c) => $c->where('contracts.client_id', $clientId)))
            ->when($buildingId, fn (Builder $q) => $q->whereHas('contract.unit', fn (Builder $u) => $u->where('building_id', $buildingId)));
    }

    /** Rows falling due between tomorrow and seven days out (still unpaid, active contracts). */
    private function dueWithinSevenDays(Carbon $today, ?string $type, ?int $buildingId, ?int $clientId): array
    {
        $rows = Installment::query()
            ->whereHas('contract', fn (Builder $q) => $q->where('contracts.status', ContractStatus::ACTIVE->value))
            ->where('installments.remaining', '>', 0)
            ->whereDate('installments.due_date', '>=', $today->copy()->addDay()->toDateString())
            ->whereDate('installments.due_date', '<=', $today->copy()->addDays(7)->toDateString())
            ->when($type, fn (Builder $q) => $q->whereHas('contract', fn (Builder $c) => $c->where('contracts.type', $type)))
            ->when($clientId, fn (Builder $q) => $q->whereHas('contract', fn (Builder $c) => $c->where('contracts.client_id', $clientId)))
            ->when($buildingId, fn (Builder $q) => $q->whereHas('contract.unit', fn (Builder $u) => $u->where('building_id', $buildingId)))
            ->pluck('remaining')
            ->map(fn ($value) => (string) $value)
            ->all();

        return [
            'count' => count($rows),
            'total' => (float) MoneyCalculator::sumPayments($rows),
        ];
    }

    /** One installment, flattened into the columns the report shows. */
    private function row(Installment $installment, Carbon $today): array
    {
        $dueDate = $installment->due_date;
        $days = (int) $dueDate->diffInDays($today);

        return [
            'id' => $installment->id,
            'contract_id' => $installment->contract_id,
            'contract_number' => $installment->contract?->number,
            'contract_type' => $installment->contract?->type?->value,
            'client_id' => $installment->contract?->client_id,
            'client_name' => $installment->contract?->client?->name,
            'unit_name' => $installment->contract?->unit?->name,
            'building_name' => $installment->contract?->unit?->building?->name,
            'sequence_number' => (int) $installment->sequence_number,
            'due_date' => $dueDate->toDateString(),
            'amount' => $this->amount($installment->amount),
            'paid_amount' => $this->amount($installment->paid_amount),
            'remaining' => $this->amount($installment->remaining),
            'days_overdue' => $days,
            'bucket' => $this->bucketOf($days),
        ];
    }

    /** 0-30 / 31-60 / 61-90 / +90 days late; a row due today lands in the first bucket. */
    private function bucketOf(int $days): string
    {
        return $days <= 30 ? '0-30' : ($days <= 60 ? '31-60' : ($days <= 90 ? '61-90' : '90+'));
    }

    /** @param  array<int, array<string, mixed>>  $rows */
    private function rollup(array $rows): array
    {
        return [
            'count' => count($rows),
            'total' => (float) MoneyCalculator::sumPayments(array_map(fn (array $row) => (string) $row['remaining'], $rows)),
        ];
    }

    private function amount(mixed $value): float
    {
        return round((float) ($value ?? 0), 2);
    }
}
