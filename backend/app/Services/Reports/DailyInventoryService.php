<?php

namespace App\Services\Reports;

use App\Models\Contract;
use App\Models\Installment;
use App\Services\Audit\AuditLogger;
use App\Support\Transactions\Operation;
use App\Support\Money\MoneyCalculator;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class DailyInventoryService extends BaseReportService
{
    public function generate(string $targetDate): array
    {
        // Payments collected ON this date (by payment date, not entry date)
        $paymentsDate = $targetDate;
        $payments = $this->paymentsQuery($paymentsDate, $paymentsDate)
            ->get();

        $cancelledPayments = $this->cancelledPaymentsQuery($paymentsDate, $paymentsDate)
            ->get();

        // Split collected by payment type and method
        $collectedByType = [
            'reservation' => 0.0,
            'down_payment' => 0.0,
            'installment' => 0.0,
        ];
        $collectedByMethod = array_fill_keys(\App\Enums\PaymentMethod::allValues(), 0.0);
        $collectedByBuilding = [];

        $totalCollected = 0.0;
        $paymentDetail = [];

        foreach ($payments as $p) {
            $amount = (float) $p->amount;
            $totalCollected += $amount;

            $collectedByType[$p->payment_type] += $amount;
            $method = $p->payment_method ?? 'other';
            $collectedByMethod[$method] = ($collectedByMethod[$method] ?? 0) + $amount;

            // Building breakdown
            $buildingId = $p->building_id;
            if (!isset($collectedByBuilding[$buildingId])) {
                $building = $buildingId ? \App\Models\Building::find($buildingId) : null;
                $collectedByBuilding[$buildingId] = [
                    'building_id' => $buildingId,
                    'building_name' => $building?->name,
                    'collected' => 0.0,
                ];
            }
            $collectedByBuilding[$buildingId]['collected'] += $amount;

            $paymentDetail[] = [
                'id' => $p->id,
                'paid_at' => $p->paid_at,
                'type' => $p->payment_type,
                'amount' => $this->money($amount),
                'method' => $method,
                'building_id' => $buildingId,
                'client_id' => $p->client_id,
                'unit_id' => $p->unit_id,
            ];
        }

        // Cancelled payments shown separately and deducted
        $totalCancelled = 0.0;
        $cancelledDetail = [];
        foreach ($cancelledPayments as $p) {
            $amount = (float) $p->amount;
            $totalCancelled += $amount;
            $cancelledDetail[] = [
                'id' => $p->id,
                'cancelled_at' => $p->cancelled_at,
                'type' => $p->payment_type,
                'amount' => $this->money($amount),
                'method' => $p->payment_method ?? 'other',
                'cancel_reason' => $p->cancel_reason,
            ];
        }

        $netCollected = $totalCollected - $totalCancelled;

        // Cumulative balance (all time)
        $allPayments = $this->paymentsQuery('1900-01-01', $targetDate)->get();
        $allCancelled = $this->cancelledPaymentsQuery('1900-01-01', $targetDate)->get();
        $cumulativeCollected = 0.0;
        $cumulativeCancelled = 0.0;
        foreach ($allPayments as $p) {
            $cumulativeCollected += (float) $p->amount;
        }
        foreach ($allCancelled as $p) {
            $cumulativeCancelled += (float) $p->amount;
        }
        $cumulativeBalance = $cumulativeCollected - $cumulativeCancelled;

        // Expected: installments due today
        $installmentsDueToday = Installment::where('due_date', $targetDate)
            ->whereNotIn('status', ['paid', 'cancelled'])
            ->with('contract')
            ->get();

        $expectedToday = 0.0;
        $overdueCount = 0;
        $overdueTotal = 0.0;
        foreach ($installmentsDueToday as $inst) {
            $expectedToday += (float) $inst->remaining;
        }

        // Overdue installments (due date passed, remaining > 0)
        $overdueInstallments = Installment::where('due_date', '<', $targetDate)
            ->where('remaining', '>', 0)
            ->whereNotIn('status', ['paid', 'cancelled'])
            ->get();
        foreach ($overdueInstallments as $inst) {
            $overdueCount++;
            $overdueTotal += (float) $inst->remaining;
        }

        // Expected this week and month
        $weekEnd = Carbon::parse($targetDate)->addDays(6)->format('Y-m-d');
        $monthEnd = Carbon::parse($targetDate)->endOfMonth()->format('Y-m-d');

        $expectedThisWeek = Installment::whereBetween('due_date', [$targetDate, $weekEnd])
            ->whereNotIn('status', ['paid', 'cancelled'])
            ->where('remaining', '>', 0)
            ->sum('remaining');

        $expectedThisMonth = Installment::whereBetween('due_date', [$targetDate, $monthEnd])
            ->whereNotIn('status', ['paid', 'cancelled'])
            ->where('remaining', '>', 0)
            ->sum('remaining');

        // Incomplete down payments
        $incompleteDownPayments = \App\Models\Contract::where('status', 'active')
            ->where('agreed_down_payment', '>', DB::raw('(SELECT COALESCE(SUM(amount),0) FROM contract_down_payments cdp WHERE cdp.contract_id = contracts.id AND cdp.status = \'valid\')'))
            ->get();

        $incompleteDownPaymentTotal = 0.0;
        foreach ($incompleteDownPayments as $c) {
            $paid = (float) $c->paid_down_payment;
            $agreed = (float) $c->agreed_down_payment;
            $incompleteDownPaymentTotal += ($agreed - $paid);
        }

        // Total remaining on all contracts
        $allContracts = \App\Models\Contract::where('status', 'active')->get();
        $totalRemainingAllContracts = 0.0;
        foreach ($allContracts as $c) {
            $totalRemainingAllContracts += (float) $c->total_price - (float) $c->total_collected;
        }

        $this->logReportAccess('daily_inventory', [
            'target_date' => $targetDate,
        ]);

        return [
            'target_date' => $targetDate,
            'summary' => [
                'collected_today' => $this->money($totalCollected),
                'cancelled_today' => $this->money($totalCancelled),
                'net_collected_today' => $this->money($netCollected),
                'cumulative_balance' => $this->money($cumulativeBalance),
            ],
            'collected_by_type' => array_map(fn ($v, $k) => [
                'type' => $k,
                'amount' => $this->money($v),
            ], $collectedByType, array_keys($collectedByType)),
            'collected_by_method' => array_map(fn ($v, $k) => [
                'method' => $k,
                'amount' => $this->money($v),
            ], $collectedByMethod, array_keys($collectedByMethod)),
            'collected_by_building' => array_values(array_map(fn ($g) => [
                'building_id' => $g['building_id'],
                'building_name' => $g['building_name'],
                'collected' => $this->money($g['collected']),
            ], $collectedByBuilding)),
            'expected' => [
                'due_today' => $this->money($expectedToday),
                'overdue_count' => $overdueCount,
                'overdue_total' => $this->money($overdueTotal),
                'expected_this_week' => $this->money((float) $expectedThisWeek),
                'expected_this_month' => $this->money((float) $expectedThisMonth),
                'incomplete_down_payments' => $this->money($incompleteDownPaymentTotal),
                'total_remaining_all_contracts' => $this->money($totalRemainingAllContracts),
            ],
            'payments_detail' => $paymentDetail,
            'cancelled_payments_detail' => $cancelledDetail,
        ];
    }
}