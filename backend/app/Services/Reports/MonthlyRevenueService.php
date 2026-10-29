<?php

namespace App\Services\Reports;

use Carbon\Carbon;

/**
 * «الإيرادات الشهرية»: the money actually collected per month — reservation deposits, contract down
 * payments and installments — with the cancelled lines reported separately.
 *
 * It reads the shared payment union (valid rows only), so a month's total is real cash, not contract
 * values: a contract signed this month that has not been paid yet contributes nothing.
 */
class MonthlyRevenueService extends BaseReportService
{
    /** The union's `payment_type` and the month column each one feeds. */
    private const TYPE_COLUMN = [
        'reservation' => 'reservations',
        'down_payment' => 'down_payments',
        'installment' => 'installments',
    ];

    public function generate(string $fromDate, string $toDate, ?int $buildingId = null): array
    {
        $filters = ['building_id' => $buildingId];

        $payments = $this->paymentsQuery($fromDate, $toDate, $filters)->get();
        $cancelledPayments = $this->cancelledPaymentsQuery($fromDate, $toDate, $filters)->get();

        $months = [];
        $receipts = [];

        $bucket = function (string $month) use (&$months): void {
            $months[$month] ??= [
                'month' => $month,
                'payments' => 0,
                'receipts' => 0,
                'reservations' => 0.0,
                'down_payments' => 0.0,
                'installments' => 0.0,
                'total' => 0.0,
                'cancelled' => 0.0,
                'cumulative' => 0.0,
            ];
        };

        foreach ($payments as $payment) {
            $month = $this->monthOf($payment->paid_at);
            if ($month === null) {
                continue;
            }

            $bucket($month);
            $months[$month]['payments']++;
            $months[$month][self::TYPE_COLUMN[(string) $payment->payment_type]] += (float) $payment->amount;
            $months[$month]['total'] += (float) $payment->amount;

            // One receipt may cover several lines, so it is counted once per month.
            if ($payment->receipt_number !== null) {
                $receipts[$month][(string) $payment->receipt_number] = true;
            }
        }

        foreach ($cancelledPayments as $payment) {
            $month = $this->monthOf($payment->cancelled_at);
            if ($month === null) {
                continue;
            }

            // A cancelled line of a month with no valid payment still opens its row: it is reported.
            $bucket($month);
            $months[$month]['cancelled'] += (float) $payment->amount;
        }

        ksort($months);

        $run = 0.0;
        $totals = [
            'payments' => 0,
            'receipts' => 0,
            'reservations' => 0.0,
            'down_payments' => 0.0,
            'installments' => 0.0,
            'total' => 0.0,
            'cancelled' => 0.0,
        ];

        foreach (array_keys($months) as $month) {
            $months[$month]['receipts'] = count($receipts[$month] ?? []);
            $run += $months[$month]['total'];
            $months[$month]['cumulative'] = $run;

            foreach (['reservations', 'down_payments', 'installments', 'total', 'cancelled', 'cumulative'] as $field) {
                $months[$month][$field] = $this->amount($months[$month][$field]);
            }

            foreach (['payments', 'receipts', 'reservations', 'down_payments', 'installments', 'total', 'cancelled'] as $field) {
                $totals[$field] += $months[$month][$field];
            }
        }

        foreach (['reservations', 'down_payments', 'installments', 'total', 'cancelled'] as $field) {
            $totals[$field] = $this->amount($totals[$field]);
        }

        $this->logReportAccess('monthly_revenue', [
            'from_date' => $fromDate,
            'to_date' => $toDate,
            'building_id' => $buildingId,
        ]);

        return [
            'period' => [
                'from' => $fromDate,
                'to' => $toDate,
            ],
            'months' => array_values($months),
            'totals' => $totals,
        ];
    }

    /** `Y-m` of a payment date, or null when the row has none. */
    private function monthOf(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return Carbon::parse($value)->format('Y-m');
    }

    private function amount(mixed $value): float
    {
        return round((float) ($value ?? 0), 2);
    }
}
