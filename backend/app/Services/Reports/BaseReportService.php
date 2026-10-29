<?php

namespace App\Services\Reports;

use App\Enums\AuditAction;
use App\Enums\ContractType;
use App\Enums\InstallmentStatus;
use App\Enums\PaymentStatus;
use App\Models\Contract;
use App\Models\Installment;
use App\Models\Reservation;
use App\Models\Unit;
use App\Services\Audit\AuditLogger;
use App\Support\Money\MoneyCalculator;
use App\Support\Transactions\Operation;
use Carbon\Carbon;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

abstract class BaseReportService
{
    public function __construct(
        protected Operation $operation,
        protected AuditLogger $audit
    ) {}

    /**
     * Money rollup of one contract for the building/unit statements. Sale: value = the agreed
     * price, paid = down payment (the reservation deposit included) + schedule payments, remaining
     * = both balances left. Lease: value = the whole schedule, paid/remaining from the schedule
     * only (the deposit is separate — see DEFAULTS). Cancelled schedule rows never count: their
     * `remaining` is still stored after a contract cancellation.
     *
     * @return array<string, mixed>
     */
    protected function contractMoney(Contract $contract, Carbon $today): array
    {
        $isRent = $contract->type === ContractType::RENT;
        $rows = $contract->installments
            ->filter(fn (Installment $i) => $i->status !== InstallmentStatus::CANCELLED);

        $string = fn ($value) => (string) $value;
        $installmentsTotal = MoneyCalculator::sumPayments($rows->pluck('amount')->map($string)->all());
        $installmentsPaid = MoneyCalculator::sumPayments($rows->pluck('paid_amount')->map($string)->all());
        $installmentsRemaining = MoneyCalculator::sumPayments($rows->pluck('remaining')->map($string)->all());

        $overdue = '0.00';
        $due = '0.00';
        $todayDate = $today->toDateString();
        $monthEnd = $today->copy()->endOfMonth()->toDateString();
        foreach ($rows as $row) {
            if ((float) $row->remaining <= 0 || $row->due_date === null) {
                continue;
            }
            $date = $row->due_date->toDateString();
            if ($date < $todayDate) {
                $overdue = MoneyCalculator::sumPayments([$overdue, $string($row->remaining)]);
            }
            if ($date <= $monthEnd) {
                $due = MoneyCalculator::sumPayments([$due, $string($row->remaining)]);
            }
        }

        $downAgreed = $isRent ? '0.00' : (string) $contract->agreed_down_payment;
        $downPaid = (string) $contract->paid_down_payment;
        $downRemaining = $isRent ? '0.00' : MoneyCalculator::remaining($downAgreed, $downPaid);

        return [
            'is_rent' => $isRent,
            'value' => (float) ($isRent ? $installmentsTotal : (string) $contract->total_price),
            'paid' => (float) ($isRent ? $installmentsPaid : MoneyCalculator::sumPayments([$downPaid, $installmentsPaid])),
            'remaining' => (float) ($isRent ? $installmentsRemaining : MoneyCalculator::sumPayments([$downRemaining, $installmentsRemaining])),
            'installments_total' => (float) $installmentsTotal,
            'installments_paid' => (float) $installmentsPaid,
            'installments_remaining' => (float) $installmentsRemaining,
            'down_payment' => (float) $downAgreed,
            'down_payment_paid' => (float) $downPaid,
            'down_payment_remaining' => (float) $downRemaining,
            'overdue' => (float) $overdue,
            // What is left of the rows falling due until the end of the current month.
            'due' => (float) $due,
            'rows_count' => $rows->count(),
            'paid_count' => $rows->filter(fn (Installment $i) => (float) $i->remaining <= 0)->count(),
        ];
    }

    /** The columns each union branch exposes, so a filter can be applied inside every branch. */
    private const PAYMENT_FILTER_COLUMNS = [
        'reservation' => ['client_id' => 'r.client_id', 'unit_id' => 'r.unit_id', 'building_id' => 'r.building_id'],
        'down_payment' => ['client_id' => 'c.client_id', 'unit_id' => 'c.unit_id', 'building_id' => 'b.id', 'contract_id' => 'c.id'],
        'installment' => ['client_id' => 'c.client_id', 'unit_id' => 'c.unit_id', 'building_id' => 'b.id', 'contract_id' => 'i.contract_id'],
    ];

    /**
     * Get all payments across the 3 tables within a date range.
     * Returns a UNION query with a consistent structure.
     *
     * The filters are applied inside every branch: a `where` added after `unionAll()` would only
     * narrow the first select.
     *
     * Besides the ids, every row carries what a collection list prints: the contract number/type,
     * the installment number, the receipt number (null when the payment was recorded straight on an
     * installment) and the client / unit / building names.
     *
     * @param  array{client_id?: int|null, unit_id?: int|null, building_id?: int|null, contract_id?: int|null}  $filters
     */
    protected function paymentsQuery(string $fromDate, string $toDate, array $filters = [])
    {
        $reservationPayments = $this->withPaymentFilters(DB::table('reservation_payments as rp')
            ->select([
                'rp.id',
                'rp.reservation_id as entity_id',
                'rp.amount',
                'rp.paid_at',
                'rp.payment_method',
                'rp.status',
                'rp.cancelled_at',
                DB::raw('\'reservation\' as payment_type'),
                'r.client_id',
                'r.unit_id',
                'r.building_id',
                // A reservation has no contract yet; the contract is created on conversion.
                DB::raw('NULL as contract_id'),
                DB::raw('NULL as contract_number'),
                DB::raw('NULL as contract_type'),
                DB::raw('NULL as sequence_number'),
                // Reservation payments are recorded on the reservation, outside the receipts table.
                DB::raw('NULL as receipt_number'),
                'cl.name as client_name',
                'u.name as unit_name',
                'b.name as building_name',
            ])
            ->join('reservations as r', 'rp.reservation_id', '=', 'r.id')
            ->leftJoin('clients as cl', 'r.client_id', '=', 'cl.id')
            ->leftJoin('units as u', 'r.unit_id', '=', 'u.id')
            ->leftJoin('buildings as b', 'r.building_id', '=', 'b.id')
            ->where('rp.paid_at', '>=', $fromDate)
            ->where('rp.paid_at', '<=', $toDate)
            // Only money still on the books: a cancelled receipt line is reported by cancelledPaymentsQuery.
            ->where('rp.status', PaymentStatus::VALID->value)
            ->whereNull('rp.deleted_at'), 'reservation', $filters);

        $downPayments = $this->withPaymentFilters(DB::table('contract_down_payments as cdp')
            ->select([
                'cdp.id',
                'cdp.contract_id as entity_id',
                'cdp.amount',
                'cdp.paid_at',
                'cdp.payment_method',
                'cdp.status',
                'cdp.cancelled_at',
                DB::raw('\'down_payment\' as payment_type'),
                'c.client_id',
                'c.unit_id',
                'b.id as building_id',
                'cdp.contract_id as contract_id',
                'c.number as contract_number',
                'c.type as contract_type',
                DB::raw('NULL as sequence_number'),
                'rc.number as receipt_number',
                'cl.name as client_name',
                'u.name as unit_name',
                'b.name as building_name',
            ])
            ->join('contracts as c', 'cdp.contract_id', '=', 'c.id')
            ->join('units as u', 'c.unit_id', '=', 'u.id')
            ->join('buildings as b', 'u.building_id', '=', 'b.id')
            ->leftJoin('clients as cl', 'c.client_id', '=', 'cl.id')
            ->leftJoin('receipts as rc', 'cdp.receipt_id', '=', 'rc.id')
            ->where('cdp.paid_at', '>=', $fromDate)
            ->where('cdp.paid_at', '<=', $toDate)
            ->where('cdp.status', PaymentStatus::VALID->value)
            ->whereNull('cdp.deleted_at'), 'down_payment', $filters);

        $installmentPayments = $this->withPaymentFilters(DB::table('installment_payments as ip')
            ->select([
                'ip.id',
                'ip.installment_id as entity_id',
                'ip.amount',
                'ip.paid_at',
                'ip.payment_method',
                'ip.status',
                'ip.cancelled_at',
                DB::raw('\'installment\' as payment_type'),
                'c.client_id',
                'c.unit_id',
                'b.id as building_id',
                'i.contract_id as contract_id',
                'c.number as contract_number',
                'c.type as contract_type',
                'i.sequence_number',
                'rc.number as receipt_number',
                'cl.name as client_name',
                'u.name as unit_name',
                'b.name as building_name',
            ])
            ->join('installments as i', 'ip.installment_id', '=', 'i.id')
            ->join('contracts as c', 'i.contract_id', '=', 'c.id')
            ->join('units as u', 'c.unit_id', '=', 'u.id')
            ->join('buildings as b', 'u.building_id', '=', 'b.id')
            ->leftJoin('clients as cl', 'c.client_id', '=', 'cl.id')
            ->leftJoin('receipts as rc', 'ip.receipt_id', '=', 'rc.id')
            ->where('ip.paid_at', '>=', $fromDate)
            ->where('ip.paid_at', '<=', $toDate)
            ->where('ip.status', PaymentStatus::VALID->value)
            ->whereNull('ip.deleted_at'), 'installment', $filters);

        return $reservationPayments->unionAll($downPayments)->unionAll($installmentPayments);
    }

    /**
     * Get cancelled payments separately.
     */
    protected function cancelledPaymentsQuery(string $fromDate, string $toDate, array $filters = [])
    {
        $reservationPayments = $this->withPaymentFilters(DB::table('reservation_payments as rp')
            ->select([
                'rp.id',
                'rp.reservation_id as entity_id',
                'rp.amount',
                'rp.paid_at',
                'rp.payment_method',
                'rp.cancel_reason',
                'rp.cancelled_at',
                DB::raw('\'reservation\' as payment_type'),
                'r.client_id',
                'r.unit_id',
                'r.building_id',
                // A reservation has no contract yet; the contract is created on conversion.
                DB::raw('NULL as contract_id'),
                DB::raw('NULL as contract_number'),
                DB::raw('NULL as contract_type'),
                DB::raw('NULL as sequence_number'),
                DB::raw('NULL as receipt_number'),
                'cl.name as client_name',
                'u.name as unit_name',
                'b.name as building_name',
            ])
            ->join('reservations as r', 'rp.reservation_id', '=', 'r.id')
            ->leftJoin('clients as cl', 'r.client_id', '=', 'cl.id')
            ->leftJoin('units as u', 'r.unit_id', '=', 'u.id')
            ->leftJoin('buildings as b', 'r.building_id', '=', 'b.id')
            // `cancelled_at` is a timestamp: a plain string bound would drop a cancellation made
            // on the last day of the period (e.g. '2026-10-29 18:30' > '2026-10-29').
            ->whereDate('rp.cancelled_at', '>=', $fromDate)
            ->whereDate('rp.cancelled_at', '<=', $toDate)
            ->whereNotNull('rp.cancelled_at'), 'reservation', $filters);

        $downPayments = $this->withPaymentFilters(DB::table('contract_down_payments as cdp')
            ->select([
                'cdp.id',
                'cdp.contract_id as entity_id',
                'cdp.amount',
                'cdp.paid_at',
                'cdp.payment_method',
                'cdp.cancel_reason',
                'cdp.cancelled_at',
                DB::raw('\'down_payment\' as payment_type'),
                'c.client_id',
                'c.unit_id',
                'b.id as building_id',
                'cdp.contract_id as contract_id',
                'c.number as contract_number',
                'c.type as contract_type',
                DB::raw('NULL as sequence_number'),
                'rc.number as receipt_number',
                'cl.name as client_name',
                'u.name as unit_name',
                'b.name as building_name',
            ])
            ->join('contracts as c', 'cdp.contract_id', '=', 'c.id')
            ->join('units as u', 'c.unit_id', '=', 'u.id')
            ->join('buildings as b', 'u.building_id', '=', 'b.id')
            ->leftJoin('clients as cl', 'c.client_id', '=', 'cl.id')
            ->leftJoin('receipts as rc', 'cdp.receipt_id', '=', 'rc.id')
            // `cancelled_at` is a timestamp: a plain string bound would drop a cancellation made
            // on the last day of the period (e.g. '2026-10-29 18:30' > '2026-10-29').
            ->whereDate('cdp.cancelled_at', '>=', $fromDate)
            ->whereDate('cdp.cancelled_at', '<=', $toDate)
            ->whereNotNull('cdp.cancelled_at'), 'down_payment', $filters);

        $installmentPayments = $this->withPaymentFilters(DB::table('installment_payments as ip')
            ->select([
                'ip.id',
                'ip.installment_id as entity_id',
                'ip.amount',
                'ip.paid_at',
                'ip.payment_method',
                'ip.cancel_reason',
                'ip.cancelled_at',
                DB::raw('\'installment\' as payment_type'),
                'c.client_id',
                'c.unit_id',
                'b.id as building_id',
                'i.contract_id as contract_id',
                'c.number as contract_number',
                'c.type as contract_type',
                'i.sequence_number',
                'rc.number as receipt_number',
                'cl.name as client_name',
                'u.name as unit_name',
                'b.name as building_name',
            ])
            ->join('installments as i', 'ip.installment_id', '=', 'i.id')
            ->join('contracts as c', 'i.contract_id', '=', 'c.id')
            ->join('units as u', 'c.unit_id', '=', 'u.id')
            ->join('buildings as b', 'u.building_id', '=', 'b.id')
            ->leftJoin('clients as cl', 'c.client_id', '=', 'cl.id')
            ->leftJoin('receipts as rc', 'ip.receipt_id', '=', 'rc.id')
            // `cancelled_at` is a timestamp: a plain string bound would drop a cancellation made
            // on the last day of the period (e.g. '2026-10-29 18:30' > '2026-10-29').
            ->whereDate('ip.cancelled_at', '>=', $fromDate)
            ->whereDate('ip.cancelled_at', '<=', $toDate)
            ->whereNotNull('ip.cancelled_at'), 'installment', $filters);

        return $reservationPayments->unionAll($downPayments)->unionAll($installmentPayments);
    }

    /**
     * Apply the report filters to one union branch (see self::PAYMENT_FILTER_COLUMNS).
     *
     * @param  Builder  $query
     * @param  array<string, int|null>  $filters
     * @return Builder
     */
    private function withPaymentFilters($query, string $branch, array $filters)
    {
        $columns = self::PAYMENT_FILTER_COLUMNS[$branch];

        foreach ($filters as $key => $value) {
            if ($value !== null && isset($columns[$key])) {
                $query->where($columns[$key], $value);
            }
        }

        return $query;
    }

    /**
     * Format money value to 2 decimal string.
     */
    protected function money(float $value): string
    {
        return number_format($value, 2, '.', '');
    }

    /**
     * Log report access (sensitive read).
     */
    protected function logReportAccess(string $reportType, array $meta = []): void
    {
        $this->audit->log(
            action: AuditAction::EXPORT->value,
            entityType: 'reports',
            entityId: null,
            newValues: array_merge(['report_type' => $reportType], $meta),
            isAutomatic: false,
            reason: 'Report accessed: '.$reportType,
        );
    }
}
