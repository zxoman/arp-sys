<?php

namespace App\Services\Reports;

use App\Enums\PaymentMethod;
use Carbon\Carbon;

/**
 * «التحصيل اليومي»: every valid payment of a period with what it paid, who paid it and how — plus
 * per-day / per-method / per-type rollups. The same endpoint with `from = to` is one day's drawer.
 *
 * Cancelled lines are returned separately (with their reason) and never enter the collected totals.
 */
class DailyCollectionService extends BaseReportService
{
    public function generate(string $fromDate, string $toDate, ?int $buildingId = null): array
    {
        $filters = ['building_id' => $buildingId];

        $payments = $this->paymentsQuery($fromDate, $toDate, $filters)
            ->orderByDesc('paid_at')
            ->orderByDesc('id')
            ->get();
        $cancelledPayments = $this->cancelledPaymentsQuery($fromDate, $toDate, $filters)
            ->orderByDesc('cancelled_at')
            ->get();

        $byType = [
            'reservation' => ['type' => 'reservation', 'amount' => 0.0, 'lines' => 0],
            'down_payment' => ['type' => 'down_payment', 'amount' => 0.0, 'lines' => 0],
            'installment' => ['type' => 'installment', 'amount' => 0.0, 'lines' => 0],
        ];
        $byMethod = [];
        $byDay = [];
        $receipts = [];
        $rows = [];
        $collected = 0.0;

        foreach ($payments as $payment) {
            $amount = (float) $payment->amount;
            $collected += $amount;
            $type = (string) $payment->payment_type;
            $method = $payment->payment_method ?? PaymentMethod::OTHER->value;
            $day = $payment->paid_at === null ? null : Carbon::parse($payment->paid_at)->toDateString();

            $byType[$type]['amount'] += $amount;
            $byType[$type]['lines']++;

            $byMethod[$method] ??= ['method' => $method, 'amount' => 0.0, 'lines' => 0];
            $byMethod[$method]['amount'] += $amount;
            $byMethod[$method]['lines']++;

            if ($day !== null) {
                $byDay[$day] ??= ['date' => $day, 'amount' => 0.0, 'lines' => 0];
                $byDay[$day]['amount'] += $amount;
                $byDay[$day]['lines']++;
            }

            if ($payment->receipt_number !== null) {
                $receipts[(string) $payment->receipt_number] = true;
            }

            $rows[] = [
                'id' => (int) $payment->id,
                'payment_type' => $type,
                'paid_at' => $day,
                'amount' => $this->amount($amount),
                'method' => $method,
                'receipt_number' => $payment->receipt_number,
                'contract_id' => $payment->contract_id === null ? null : (int) $payment->contract_id,
                'contract_number' => $payment->contract_number,
                'contract_type' => $payment->contract_type,
                'sequence_number' => $payment->sequence_number === null ? null : (int) $payment->sequence_number,
                'client_id' => $payment->client_id === null ? null : (int) $payment->client_id,
                'client_name' => $payment->client_name,
                'unit_name' => $payment->unit_name,
                'building_id' => $payment->building_id === null ? null : (int) $payment->building_id,
                'building_name' => $payment->building_name,
            ];
        }

        $cancelled = [];
        $cancelledTotal = 0.0;
        foreach ($cancelledPayments as $payment) {
            $cancelledTotal += (float) $payment->amount;
            $cancelled[] = [
                'id' => (int) $payment->id,
                'payment_type' => (string) $payment->payment_type,
                'paid_at' => $payment->paid_at === null ? null : Carbon::parse($payment->paid_at)->toDateString(),
                'cancelled_at' => $payment->cancelled_at === null ? null : Carbon::parse($payment->cancelled_at)->toDateString(),
                'amount' => $this->amount($payment->amount),
                'method' => $payment->payment_method ?? PaymentMethod::OTHER->value,
                'receipt_number' => $payment->receipt_number,
                'contract_number' => $payment->contract_number,
                'contract_type' => $payment->contract_type,
                'sequence_number' => $payment->sequence_number === null ? null : (int) $payment->sequence_number,
                'client_name' => $payment->client_name,
                'unit_name' => $payment->unit_name,
                'cancel_reason' => $payment->cancel_reason,
            ];
        }

        ksort($byDay);

        $this->logReportAccess('daily_collection', [
            'from_date' => $fromDate,
            'to_date' => $toDate,
            'building_id' => $buildingId,
        ]);

        return [
            'period' => [
                'from' => $fromDate,
                'to' => $toDate,
            ],
            'summary' => [
                'collected' => $this->amount($collected),
                'cancelled' => $this->amount($cancelledTotal),
                'net' => $this->amount($collected - $cancelledTotal),
                'lines' => count($rows),
                // One receipt may cover several lines; a line recorded without a receipt is not counted here.
                'receipts' => count($receipts),
                'days' => max(1, (int) Carbon::parse($fromDate)->diffInDays(Carbon::parse($toDate)) + 1),
            ],
            'by_type' => array_values(array_map(fn (array $row) => [
                'type' => $row['type'],
                'amount' => $this->amount($row['amount']),
                'lines' => $row['lines'],
            ], $byType)),
            'by_method' => array_values(array_map(fn (array $row) => [
                'method' => $row['method'],
                'amount' => $this->amount($row['amount']),
                'lines' => $row['lines'],
            ], $byMethod)),
            'by_day' => array_values(array_map(fn (array $row) => [
                'date' => $row['date'],
                'amount' => $this->amount($row['amount']),
                'lines' => $row['lines'],
            ], $byDay)),
            'payments' => $rows,
            'cancelled_payments' => $cancelled,
        ];
    }

    private function amount(mixed $value): float
    {
        return round((float) ($value ?? 0), 2);
    }
}
