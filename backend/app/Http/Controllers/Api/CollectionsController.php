<?php

namespace App\Http\Controllers\Api;

use App\Enums\ContractStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\Collections\DownPaymentCollectionResource;
use App\Http\Resources\Collections\InstallmentCollectionResource;
use App\Models\Contract;
use App\Models\Installment;
use App\Support\Money\Money;
use App\Support\Money\MoneyCalculator;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Collection (التحصيل): every installment — and every down payment — of the active contracts across
 * the system. Read-only; money is recorded through receipts. The status shown is recomputed against
 * today (an unpaid row past its due date is «متأخر» even if the stored status still says `due`).
 */
class CollectionsController extends Controller
{
    public function installments(Request $request): JsonResponse
    {
        $this->authorize('contracts.view');
        $today = Carbon::today()->toDateString();

        $query = Installment::query()
            ->whereHas('contract', fn (Builder $q) => $q->where('status', ContractStatus::ACTIVE->value));
        $this->applyInstallmentScope($query, $request);

        // Counts and totals describe the scope (search/type/client/building/date range) before the
        // status and single-day filters, so the chips and cards don't collapse to one state. The
        // type chips are counted before the type filter runs; the rest afterwards.
        $typeAggregate = $this->aggregateInstallments(clone $query, $today);
        $this->applyTypeFilter($query, $request);
        $aggregate = $this->aggregateInstallments(clone $query, $today);
        $aggregate['type_counts'] = $typeAggregate['type_counts'];

        $this->applyInstallmentStatus($query, (string) $request->query('status', ''), $today);
        if ($dueOn = $request->query('due_on')) {
            $query->whereDate('installments.due_date', $dueOn);
        }
        $this->applyDateRange($query, $request, 'installments.due_date');

        $sortable = [
            'id' => 'installments.id',
            'due_date' => 'installments.due_date',
            'amount' => 'installments.amount',
            'paid_amount' => 'installments.paid_amount',
            'remaining' => 'installments.remaining',
            'sequence_number' => 'installments.sequence_number',
        ];
        $sort = (string) $request->query('sort', 'due_date');
        $dir = $request->query('dir') === 'desc' ? 'desc' : 'asc';

        if ($sort === 'contract_number') {
            $query->orderBy(
                Contract::query()->select('number')->whereColumn('contracts.id', 'installments.contract_id'),
                $dir
            );
        } else {
            $query->orderBy($sortable[$sort] ?? 'installments.due_date', $dir);
        }
        $query->orderBy('installments.id', $dir);

        $page = $query
            ->with('contract.client', 'contract.unit.building')
            ->paginate($this->perPage($request))
            ->withQueryString();

        return $this->collectionResponse(InstallmentCollectionResource::collection($page), $page, $aggregate);
    }

    public function downPayments(Request $request): JsonResponse
    {
        $this->authorize('contracts.view');
        $today = Carbon::today()->toDateString();

        $paid = $this->downPaymentPaidExpression();
        $remaining = $this->downPaymentRemainingExpression();

        $query = Contract::query()
            ->where('status', ContractStatus::ACTIVE->value)
            ->where('agreed_down_payment', '>', 0);
        $this->applyContractScope($query, $request);

        $typeAggregate = $this->aggregateDownPayments(clone $query, $today, $paid, $remaining);
        $this->applyTypeFilter($query, $request);
        $aggregate = $this->aggregateDownPayments(clone $query, $today, $paid, $remaining);
        $aggregate['type_counts'] = $typeAggregate['type_counts'];

        $this->applyDownPaymentStatus($query, (string) $request->query('status', ''), $today, $paid, $remaining);
        if ($dueOn = $request->query('due_on')) {
            $query->whereDate('contracts.contract_date', $dueOn);
        }
        $this->applyDateRange($query, $request, 'contracts.contract_date');

        $sort = (string) $request->query('sort', 'due_date');
        $dir = $request->query('dir') === 'desc' ? 'desc' : 'asc';
        $sortable = [
            'id' => 'contracts.id',
            'contract_number' => 'contracts.number',
            'due_date' => 'contracts.contract_date',
            'amount' => 'contracts.agreed_down_payment',
        ];
        if ($sort === 'paid_amount') {
            $query->orderByRaw("{$paid} {$dir}");
        } elseif ($sort === 'remaining') {
            $query->orderByRaw("{$remaining} {$dir}");
        } else {
            $query->orderBy($sortable[$sort] ?? 'contracts.contract_date', $dir);
        }
        $query->orderBy('contracts.id', $dir);

        $page = $query
            ->select('contracts.*')
            ->selectRaw("{$paid} as paid_total, {$remaining} as remaining_total")
            ->with('client', 'unit.building', 'reservation.payments', 'downPayments')
            ->paginate($this->perPage($request))
            ->withQueryString();

        return $this->collectionResponse(DownPaymentCollectionResource::collection($page), $page, $aggregate);
    }

    /** Per-day totals for the month calendar above the table. */
    public function installmentCalendar(Request $request): JsonResponse
    {
        $this->authorize('contracts.view');
        [$month, $start, $end] = $this->monthRange($request);
        $today = Carbon::today();

        $query = Installment::query()
            ->whereHas('contract', fn (Builder $q) => $q->where('status', ContractStatus::ACTIVE->value))
            ->whereBetween('installments.due_date', [$start->toDateString(), $end->toDateString()]);
        $this->applyInstallmentScope($query, $request);
        $this->applyTypeFilter($query, $request);

        $days = [];
        foreach ($query->get(['installments.due_date', 'installments.remaining']) as $row) {
            $date = $row->due_date->toDateString();
            $days[$date] = $this->bumpDay(
                $days[$date] ?? null,
                $date,
                Money::fromString((string) $row->remaining)->isPositive(),
                $row->due_date->lt($today)
            );
        }
        ksort($days);

        return response()->json([
            'data' => ['kind' => 'installment', 'month' => $month, 'days' => array_values($days)],
        ]);
    }

    /** Per-day totals of down payments, keyed by contract date. */
    public function downPaymentCalendar(Request $request): JsonResponse
    {
        $this->authorize('contracts.view');
        [$month, $start, $end] = $this->monthRange($request);
        $today = Carbon::today();

        $query = Contract::query()
            ->where('status', ContractStatus::ACTIVE->value)
            ->where('agreed_down_payment', '>', 0)
            ->whereBetween('contracts.contract_date', [$start->toDateString(), $end->toDateString()]);
        $this->applyContractScope($query, $request);
        $this->applyTypeFilter($query, $request);

        $days = [];
        foreach ($query->with('reservation.payments', 'downPayments')->get() as $contract) {
            $date = $contract->contract_date->toDateString();
            $remaining = MoneyCalculator::remaining((string) $contract->agreed_down_payment, $contract->paid_down_payment);
            $days[$date] = $this->bumpDay(
                $days[$date] ?? null,
                $date,
                Money::fromString($remaining)->isPositive(),
                $contract->contract_date->lt($today)
            );
        }
        ksort($days);

        return response()->json([
            'data' => ['kind' => 'down_payment', 'month' => $month, 'days' => array_values($days)],
        ]);
    }

    // ── Query helpers ──────────────────────────────────────────────────────────

    /** Search/client/building filters for installments (the contract is one hop away). */
    private function applyInstallmentScope(Builder $query, Request $request): void
    {
        if ($clientId = $request->query('client_id')) {
            $query->whereHas('contract', fn (Builder $q) => $q->where('client_id', $clientId));
        }
        if ($buildingId = $request->query('building_id')) {
            $query->whereHas('contract.unit', fn (Builder $q) => $q->where('building_id', $buildingId));
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $like = "%{$search}%";
            $query->whereHas('contract', function (Builder $q) use ($like) {
                $q->where('number', 'like', $like)
                    ->orWhereHas('client', fn (Builder $c) => $c->where('name', 'like', $like)
                        ->orWhere('phone', 'like', $like)
                        ->orWhere('phone_2', 'like', $like))
                    ->orWhereHas('unit', fn (Builder $u) => $u->where('name', 'like', $like)
                        ->orWhereHas('building', fn (Builder $b) => $b->where('name', 'like', $like)));
            });
        }
    }

    /** Same filters directly on the contracts table (down-payment rows are one per contract). */
    private function applyContractScope(Builder $query, Request $request): void
    {
        if ($clientId = $request->query('client_id')) {
            $query->where('contracts.client_id', $clientId);
        }
        if ($buildingId = $request->query('building_id')) {
            $query->whereHas('unit', fn (Builder $q) => $q->where('building_id', $buildingId));
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $like = "%{$search}%";
            $query->where(function (Builder $q) use ($like) {
                $q->where('contracts.number', 'like', $like)
                    ->orWhereHas('client', fn (Builder $c) => $c->where('name', 'like', $like)
                        ->orWhere('phone', 'like', $like)
                        ->orWhere('phone_2', 'like', $like))
                    ->orWhereHas('unit', fn (Builder $u) => $u->where('name', 'like', $like)
                        ->orWhereHas('building', fn (Builder $b) => $b->where('name', 'like', $like)));
            });
        }
    }

    private function applyDateRange(Builder $query, Request $request, string $column): void
    {
        if ($from = $request->query('from')) {
            $query->whereDate($column, '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->whereDate($column, '<=', $to);
        }
    }

    /** Applied after the chips are counted, so `type_counts` still describes both types. */
    private function applyTypeFilter(Builder $query, Request $request): void
    {
        if (! $type = $request->query('type')) {
            return;
        }

        if ($query->getModel() instanceof Installment) {
            $query->whereHas('contract', fn (Builder $q) => $q->where('type', $type));
        } else {
            $query->where('contracts.type', $type);
        }
    }

    /**
     * The four display states partition every row: paid (nothing left), overdue (unpaid and past
     * due), partially_paid (some paid, still due) and due (nothing paid, not past due yet).
     */
    private function applyInstallmentStatus(Builder $query, string $status, string $today): void
    {
        $unpaid = fn (Builder $q) => $q->where('installments.remaining', '>', 0);

        if ($status === 'overdue') {
            $unpaid($query)->whereDate('installments.due_date', '<', $today);
        } elseif ($status === 'partially_paid') {
            $unpaid($query)->where('installments.paid_amount', '>', 0)
                ->whereDate('installments.due_date', '>=', $today);
        } elseif ($status === 'due') {
            $unpaid($query)->where('installments.paid_amount', '<=', 0)
                ->whereDate('installments.due_date', '>=', $today);
        } elseif ($status === 'paid') {
            $query->where('installments.remaining', '<=', 0);
        }
    }

    private function applyDownPaymentStatus(
        Builder $query,
        string $status,
        string $today,
        string $paid,
        string $remaining,
    ): void {
        if ($status === 'overdue') {
            $query->whereRaw("{$remaining} > 0")->whereDate('contracts.contract_date', '<', $today);
        } elseif ($status === 'partially_paid') {
            $query->whereRaw("{$remaining} > 0")->whereRaw("{$paid} > 0")
                ->whereDate('contracts.contract_date', '>=', $today);
        } elseif ($status === 'due') {
            $query->whereRaw("{$remaining} > 0")->whereRaw("{$paid} <= 0")
                ->whereDate('contracts.contract_date', '>=', $today);
        } elseif ($status === 'paid') {
            $query->whereRaw("{$remaining} <= 0");
        }
    }

    private function aggregateInstallments(Builder $query, string $today): array
    {
        $row = $query->toBase()
            ->join('contracts', 'contracts.id', '=', 'installments.contract_id')
            ->selectRaw(
                'COUNT(*) as total_count,
                SUM(CASE WHEN contracts.type = ? THEN 1 ELSE 0 END) as sale_count,
                SUM(CASE WHEN contracts.type = ? THEN 1 ELSE 0 END) as rent_count,
                SUM(CASE WHEN installments.remaining <= 0 THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN installments.remaining > 0 AND installments.due_date < ? THEN 1 ELSE 0 END) as overdue_count,
                SUM(CASE WHEN installments.remaining > 0 AND installments.paid_amount > 0 AND installments.due_date >= ? THEN 1 ELSE 0 END) as partial_count,
                SUM(CASE WHEN installments.remaining > 0 AND installments.paid_amount <= 0 AND installments.due_date >= ? THEN 1 ELSE 0 END) as due_count,
                COALESCE(SUM(installments.amount), 0) as amount_total,
                COALESCE(SUM(installments.paid_amount), 0) as paid_total,
                COALESCE(SUM(installments.remaining), 0) as remaining_total,
                COALESCE(SUM(CASE WHEN installments.remaining > 0 AND installments.due_date < ? THEN installments.remaining ELSE 0 END), 0) as overdue_total',
                ['sale', 'rent', $today, $today, $today, $today]
            )
            ->first();

        return $this->aggregatePayload($row);
    }

    private function aggregateDownPayments(Builder $query, string $today, string $paid, string $remaining): array
    {
        $row = $query->toBase()
            ->selectRaw(
                "COUNT(*) as total_count,
                SUM(CASE WHEN contracts.type = ? THEN 1 ELSE 0 END) as sale_count,
                SUM(CASE WHEN contracts.type = ? THEN 1 ELSE 0 END) as rent_count,
                SUM(CASE WHEN {$remaining} <= 0 THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN {$remaining} > 0 AND contracts.contract_date < ? THEN 1 ELSE 0 END) as overdue_count,
                SUM(CASE WHEN {$remaining} > 0 AND {$paid} > 0 AND contracts.contract_date >= ? THEN 1 ELSE 0 END) as partial_count,
                SUM(CASE WHEN {$remaining} > 0 AND {$paid} <= 0 AND contracts.contract_date >= ? THEN 1 ELSE 0 END) as due_count,
                COALESCE(SUM(contracts.agreed_down_payment), 0) as amount_total,
                COALESCE(SUM({$paid}), 0) as paid_total,
                COALESCE(SUM({$remaining}), 0) as remaining_total,
                COALESCE(SUM(CASE WHEN {$remaining} > 0 AND contracts.contract_date < ? THEN {$remaining} ELSE 0 END), 0) as overdue_total",
                ['sale', 'rent', $today, $today, $today, $today]
            )
            ->first();

        return $this->aggregatePayload($row);
    }

    private function aggregatePayload(?object $row): array
    {
        $int = fn (string $key): int => (int) ($row->{$key} ?? 0);

        return [
            'counts' => [
                'all' => $int('total_count'),
                'due' => $int('due_count'),
                'overdue' => $int('overdue_count'),
                'partially_paid' => $int('partial_count'),
                'paid' => $int('paid_count'),
            ],
            'type_counts' => [
                'all' => $int('total_count'),
                'sale' => $int('sale_count'),
                'rent' => $int('rent_count'),
            ],
            'totals' => [
                'amount' => $this->money($row->amount_total ?? 0),
                'paid' => $this->money($row->paid_total ?? 0),
                'remaining' => $this->money($row->remaining_total ?? 0),
                'overdue' => $this->money($row->overdue_total ?? 0),
            ],
        ];
    }

    /**
     * Paid down payment: the reservation deposit (a contract may come from a reservation) plus every
     * valid down-payment receipt. Cancelled and soft-deleted payments are excluded.
     */
    private function downPaymentPaidExpression(): string
    {
        return "(COALESCE((SELECT SUM(rp.amount) FROM reservation_payments rp
                WHERE rp.reservation_id = contracts.reservation_id
                  AND rp.status = 'valid' AND rp.deleted_at IS NULL), 0)
            + COALESCE((SELECT SUM(cdp.amount) FROM contract_down_payments cdp
                WHERE cdp.contract_id = contracts.id
                  AND cdp.status = 'valid' AND cdp.deleted_at IS NULL), 0))";
    }

    private function downPaymentRemainingExpression(): string
    {
        return '(contracts.agreed_down_payment - ' . $this->downPaymentPaidExpression() . ')';
    }

    private function monthRange(Request $request): array
    {
        $month = (string) $request->query('month', '');
        if (! preg_match('/^\d{4}-\d{2}$/', $month)) {
            $month = Carbon::today()->format('Y-m');
        }
        $start = Carbon::createFromFormat('Y-m-d', $month . '-01')->startOfMonth();

        return [$month, $start, $start->copy()->endOfMonth()];
    }

    private function bumpDay(?array $day, string $date, bool $unpaid, bool $pastDue): array
    {
        $day ??= ['date' => $date, 'total' => 0, 'overdue' => 0, 'due' => 0, 'paid' => 0];
        $day['total']++;
        if (! $unpaid) {
            $day['paid']++;
        } elseif ($pastDue) {
            $day['overdue']++;
        } else {
            $day['due']++;
        }

        return $day;
    }

    private function perPage(Request $request): int
    {
        return max(1, min((int) $request->query('per_page', 15), 100));
    }

    private function money(mixed $value): string
    {
        return Money::fromString((string) $value)->toString();
    }

    private function collectionResponse($data, $page, array $aggregate): JsonResponse
    {
        return response()->json([
            'data' => $data,
            'meta' => array_merge([
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'from' => $page->firstItem(),
                'to' => $page->lastItem(),
            ], $aggregate),
        ]);
    }
}
