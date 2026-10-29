<?php

namespace App\Services\Reports;

use App\Models\Building;
use App\Models\Contract;
use App\Models\Reservation;
use App\Models\Unit;
use App\Services\Audit\AuditLogger;
use App\Support\Transactions\Operation;
use App\Support\Money\MoneyCalculator;
use Illuminate\Support\Facades\DB;

class SalesReportService extends BaseReportService
{
    public function generate(
        string $fromDate,
        string $toDate,
        array $filters = []
    ): array {
        // Build contract query with filters
        $contractQuery = \App\Models\Contract::query()
            ->whereBetween('contract_date', [$fromDate, $toDate])
            ->with('client', 'unit', 'unit.building');

        if (isset($filters['building_id'])) {
            $contractQuery->whereHas('unit.building', fn ($q) =>
                $q->where('id', $filters['building_id']));
        }
        if (isset($filters['unit_type'])) {
            $contractQuery->whereHas('unit', fn ($q) =>
                $q->where('type', $filters['unit_type']));
        }
        if (isset($filters['activity'])) {
            $contractQuery->whereHas('unit', fn ($q) =>
                $q->where('activity', $filters['activity']));
        }
        if (isset($filters['contract_type'])) {
            $contractQuery->where('type', $filters['contract_type']);
        }
        if (isset($filters['user_id'])) {
            // Contracts don't have created_by directly; we'd need to track it. Skip for now.
        }

        $contracts = $contractQuery->get();

        // Build reservation query for conversion rate
        $reservationQuery = \App\Models\Reservation::query()
            ->whereBetween('reservation_date', [$fromDate, $toDate]);

        if (isset($filters['building_id'])) {
            $reservationQuery->where('building_id', $filters['building_id']);
        }
        if (isset($filters['unit_type'])) {
            $reservationQuery->where('unit_type', $filters['unit_type']);
        }
        if (isset($filters['activity'])) {
            $reservationQuery->where('unit_activity', $filters['activity']);
        }

        $reservations = $reservationQuery->get();

        // Aggregates
        $totalContracts = $contracts->count();
        $totalContractValue = 0.0;
        $totalDownPaymentAgreed = 0.0;
        $totalCollected = 0.0;
        $totalRemaining = 0.0;

        $saleContracts = 0;
        $saleValue = 0.0;
        $saleCollected = 0.0;
        $rentContracts = 0;
        $rentValue = 0.0;
        $rentCollected = 0.0;

        foreach ($contracts as $c) {
            $totalContractValue += (float) $c->total_price;
            $totalDownPaymentAgreed += (float) $c->agreed_down_payment;
            $collected = (float) $c->total_collected;
            $totalCollected += $collected;
            $totalRemaining += (float) $c->total_price - $collected;

            if ($c->type === 'sale') {
                $saleContracts++;
                $saleValue += (float) $c->total_price;
                $saleCollected += $collected;
            } else {
                $rentContracts++;
                $rentValue += (float) $c->total_price;
                $rentCollected += $collected;
            }
        }

        // Groupings
        $byBuilding = $this->groupByBuilding($contracts);
        $byType = $this->groupByType($contracts);
        $byActivity = $this->groupByActivity($contracts);
        $byMonth = $this->groupByMonth($contracts);

        // Reservation conversion
        $reservationCount = $reservations->count();
        $convertedCount = $reservations->where('status', 'converted')->count();
        $conversionRate = $reservationCount > 0 ? round(($convertedCount / $reservationCount) * 100, 2) : 0;

        // Average price per meter
        $totalArea = 0.0;
        foreach ($contracts as $c) {
            if ($c->unit) {
                $totalArea += (float) $c->unit->area;
            }
        }
        $avgPricePerMeter = $totalArea > 0 ? round($totalContractValue / $totalArea, 2) : 0;

        $cancelledPaymentsTotal = 0.0;
        foreach ($this->cancelledPaymentsQuery($fromDate, $toDate, $filters)->get() as $p) {
            $cancelledPaymentsTotal += (float) $p->amount;
        }

        $this->logReportAccess('sales_report', [
            'from_date' => $fromDate,
            'to_date' => $toDate,
            'filters' => $filters,
        ]);

        return [
            'period' => [
                'from' => $fromDate,
                'to' => $toDate,
            ],
            'summary' => [
                'total_contracts' => $totalContracts,
                'total_contract_value' => $this->money($totalContractValue),
                'total_down_payment_agreed' => $this->money($totalDownPaymentAgreed),
                'total_collected' => $this->money($totalCollected),
                'total_remaining' => $this->money($totalRemaining),
                'cancelled_payments' => $this->money($cancelledPaymentsTotal),
            ],
            'sale' => [
                'contracts' => $saleContracts,
                'value' => $this->money($saleValue),
                'collected' => $this->money($saleCollected),
            ],
            'rent' => [
                'contracts' => $rentContracts,
                'value' => $this->money($rentValue),
                'collected' => $this->money($rentCollected),
            ],
            'reservations' => [
                'total' => $reservationCount,
                'converted' => $convertedCount,
                'conversion_rate' => $conversionRate,
            ],
            'average_price_per_meter' => $this->money($avgPricePerMeter),
            'groupings' => [
                'by_building' => $byBuilding,
                'by_type' => $byType,
                'by_activity' => $byActivity,
                'by_month' => $byMonth,
            ],
        ];
    }

    private function groupByBuilding($contracts): array
    {
        $groups = [];
        foreach ($contracts as $c) {
            $building = $c->unit?->building;
            $key = $building?->id ?? 'unknown';
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'name' => $building?->name ?? 'Unknown',
                    'contracts' => 0,
                    'value' => 0.0,
                    'collected' => 0.0,
                ];
            }
            $groups[$key]['contracts']++;
            $groups[$key]['value'] += (float) $c->total_price;
            $groups[$key]['collected'] += (float) $c->total_collected;
        }
        return array_values(array_map(fn ($g) => [
            'name' => $g['name'],
            'contracts' => $g['contracts'],
            'value' => $this->money($g['value']),
            'collected' => $this->money($g['collected']),
        ], $groups));
    }

    private function groupByType($contracts): array
    {
        $groups = [];
        foreach ($contracts as $c) {
            $key = $c->type ?? 'unknown';
            if (!isset($groups[$key])) {
                $groups[$key] = ['contracts' => 0, 'value' => 0.0, 'collected' => 0.0];
            }
            $groups[$key]['contracts']++;
            $groups[$key]['value'] += (float) $c->total_price;
            $groups[$key]['collected'] += (float) $c->total_collected;
        }
        return array_values(array_map(fn ($g) => [
            'type' => $g['key'] ?? 'unknown',
            'contracts' => $g['contracts'],
            'value' => $this->money($g['value']),
            'collected' => $this->money($g['collected']),
        ], $groups));
    }

    private function groupByActivity($contracts): array
    {
        $groups = [];
        foreach ($contracts as $c) {
            $activity = $c->unit?->activity ?? 'unknown';
            if (!isset($groups[$activity])) {
                $groups[$activity] = ['contracts' => 0, 'value' => 0.0, 'collected' => 0.0];
            }
            $groups[$activity]['contracts']++;
            $groups[$activity]['value'] += (float) $c->total_price;
            $groups[$activity]['collected'] += (float) $c->total_collected;
        }
        return array_values(array_map(fn ($g, $k) => [
            'activity' => $k,
            'contracts' => $g['contracts'],
            'value' => $this->money($g['value']),
            'collected' => $this->money($g['collected']),
        ], $groups));
    }

    private function groupByMonth($contracts): array
    {
        $groups = [];
        foreach ($contracts as $c) {
            $month = \Carbon\Carbon::parse($c->contract_date)->format('Y-m');
            if (!isset($groups[$month])) {
                $groups[$month] = ['contracts' => 0, 'value' => 0.0, 'collected' => 0.0];
            }
            $groups[$month]['contracts']++;
            $groups[$month]['value'] += (float) $c->total_price;
            $groups[$month]['collected'] += (float) $c->total_collected;
        }
        ksort($groups);
        return array_values(array_map(fn ($g, $k) => [
            'month' => $k,
            'contracts' => $g['contracts'],
            'value' => $this->money($g['value']),
            'collected' => $this->money($g['collected']),
        ], $groups));
    }
}