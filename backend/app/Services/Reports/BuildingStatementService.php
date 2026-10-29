<?php

namespace App\Services\Reports;

use App\Enums\ContractStatus;
use App\Enums\ContractType;
use App\Models\Building;
use App\Models\Contract;
use App\Models\Reservation;
use App\Models\Unit;
use Carbon\Carbon;

/**
 * «كشف عقار»: one building — its units by floor, every contract of those units with its money
 * rollup, the reservations made on it, and what was collected during the period. Read-only.
 *
 * Only **active** contracts feed the money figures (sales, remaining, due, rent, overdue): a
 * cancelled contract is listed but its amounts are history, and its schedule keeps its old
 * `remaining`. `collected` is the period's valid payments, never a sum of contract accessors.
 */
class BuildingStatementService extends BaseReportService
{
    public function generate(int $buildingId, string $fromDate, string $toDate): array
    {
        $today = Carbon::today();
        $building = Building::findOrFail($buildingId);

        $units = Unit::query()
            ->where('building_id', $buildingId)
            ->with('floor')
            ->orderBy('floor_id')
            ->orderBy('name')
            ->get();

        $contracts = Contract::query()
            ->whereIn('unit_id', $units->pluck('id'))
            ->whereIn('contracts.status', [ContractStatus::ACTIVE->value, ContractStatus::CANCELLED->value])
            ->whereDate('contract_date', '>=', $fromDate)
            ->whereDate('contract_date', '<=', $toDate)
            ->with(['client', 'unit.floor', 'installments', 'reservation.payments', 'downPayments'])
            ->orderByDesc('contract_date')
            ->orderByDesc('id')
            ->get();

        // `building_id` is stored on every reservation, including a building-level one (no unit).
        $reservations = Reservation::query()
            ->where('building_id', $buildingId)
            ->whereDate('reservation_date', '>=', $fromDate)
            ->whereDate('reservation_date', '<=', $toDate)
            ->with(['client', 'unit'])
            ->orderByDesc('reservation_date')
            ->get();

        $payments = $this->paymentsQuery($fromDate, $toDate, ['building_id' => $buildingId])->get();
        $cancelledPayments = $this->cancelledPaymentsQuery($fromDate, $toDate, ['building_id' => $buildingId])->get();

        // Payments per unit, so each floor can show what it collected; a building-level reservation
        // payment has no unit and lands on the building only.
        $collectedByUnit = [];
        foreach ($payments as $payment) {
            if ($payment->unit_id === null) {
                continue;
            }
            $unitId = (int) $payment->unit_id;
            $collectedByUnit[$unitId] = round(($collectedByUnit[$unitId] ?? 0) + (float) $payment->amount, 2);
        }

        $unitData = [];
        $counts = ['total' => 0, 'available' => 0, 'reserved' => 0, 'sold' => 0, 'rented' => 0, 'closed' => 0];
        $floorBuckets = [];

        foreach ($units as $unit) {
            $status = $unit->status?->value;
            $closed = ! $unit->is_sellable && $status === 'available';
            $floorNumber = $unit->floor?->floor_number ?? 0;

            $counts['total']++;
            if ($closed) {
                $counts['closed']++;
            } elseif (isset($counts[$status])) {
                $counts[$status]++;
            }

            if (! isset($floorBuckets[$floorNumber])) {
                $floorBuckets[$floorNumber] = [
                    'floor' => $floorNumber,
                    'floor_display_name' => $unit->floor?->display_name,
                    'units' => 0,
                    'sales' => 0.0,
                    'remaining' => 0.0,
                    'due' => 0.0,
                    'monthly_rent' => 0.0,
                    'overdue' => 0.0,
                    'collected' => 0.0,
                ];
            }
            $floorBuckets[$floorNumber]['units']++;

            $unitData[] = [
                'id' => $unit->id,
                'name' => $unit->name,
                'type' => $unit->type?->value,
                'type_label' => $unit->type?->label(),
                'status' => $status,
                'status_label' => $unit->status?->label(),
                'is_sellable' => (bool) $unit->is_sellable,
                'purpose' => $unit->purpose?->value,
                'floor' => $floorNumber,
                'floor_display_name' => $unit->floor?->display_name,
                'area' => $this->amount($unit->area),
                'rooms' => $unit->rooms,
                'bathrooms' => $unit->bathrooms,
                'total_price' => $this->amount($unit->total_price),
            ];
        }

        // Floor collection: the unit's floor, derived from the unit list above.
        $floorOfUnit = $units->mapWithKeys(fn (Unit $u) => [$u->id => $u->floor?->floor_number ?? 0]);

        $contractRows = [];
        $totals = [
            'sales' => 0.0,
            'remaining' => 0.0,
            'due' => 0.0,
            'monthly_rent' => 0.0,
            'overdue' => 0.0,
            'collected' => 0.0,
            'cancelled' => 0.0,
            'contracts' => 0,
            'active_contracts' => 0,
        ];

        foreach ($contracts as $contract) {
            $money = $this->contractMoney($contract, $today);
            $isActive = $contract->status === ContractStatus::ACTIVE;
            $isRent = $contract->type === ContractType::RENT;
            $floor = $contract->unit !== null ? ($floorOfUnit[$contract->unit_id] ?? 0) : 0;
            if (! isset($floorBuckets[$floor])) {
                $floorBuckets[$floor] = [
                    'floor' => $floor,
                    'floor_display_name' => $contract->unit?->floor?->display_name,
                    'units' => 0,
                    'sales' => 0.0,
                    'remaining' => 0.0,
                    'due' => 0.0,
                    'monthly_rent' => 0.0,
                    'overdue' => 0.0,
                    'collected' => 0.0,
                ];
            }

            if ($isActive) {
                $totals['contracts']++;
                $totals['active_contracts']++;
                $totals['sales'] += $isRent ? 0.0 : $money['value'];
                $totals['remaining'] += $money['remaining'];
                $totals['due'] += $money['due'];
                $totals['overdue'] += $money['overdue'];
                $totals['monthly_rent'] += $isRent ? $this->amount($contract->monthly_rent) : 0.0;

                $floorBuckets[$floor]['sales'] += $isRent ? 0.0 : $money['value'];
                $floorBuckets[$floor]['remaining'] += $money['remaining'];
                $floorBuckets[$floor]['due'] += $money['due'];
                $floorBuckets[$floor]['overdue'] += $money['overdue'];
                $floorBuckets[$floor]['monthly_rent'] += $isRent ? $this->amount($contract->monthly_rent) : 0.0;
            } elseif ($contract->status === ContractStatus::CANCELLED) {
                $totals['contracts']++;
            }

            $contractRows[] = $this->contractRow($contract, $money);
        }

        // Collected is the period's money, not a per-contract lifetime figure.
        foreach ($collectedByUnit as $unitId => $amount) {
            $floor = $floorOfUnit[$unitId] ?? 0;
            if (isset($floorBuckets[$floor])) {
                $floorBuckets[$floor]['collected'] += $amount;
            }
        }
        foreach ($payments as $payment) {
            $totals['collected'] += (float) $payment->amount;
        }
        foreach ($cancelledPayments as $payment) {
            $totals['cancelled'] += (float) $payment->amount;
        }

        $reservationData = $reservations->map(fn (Reservation $r) => [
            'id' => $r->id,
            'client_id' => $r->client_id,
            'client_name' => $r->client?->name,
            'client_phone' => $r->client?->phone,
            'unit_id' => $r->unit_id,
            'unit_name' => $r->unit?->name,
            'unit_type' => $r->unit_type,
            'reservation_date' => $r->reservation_date?->toDateString(),
            'status' => $r->status?->value,
            'status_label' => $r->status?->label(),
            'deposit_paid' => $this->amount($r->deposit_paid),
            // A building-level reservation has no unit and lands on the building alone.
            'is_building_level' => $r->unit_id === null,
        ])->all();

        ksort($floorBuckets);
        foreach ($floorBuckets as $key => $floorRow) {
            foreach (['sales', 'remaining', 'due', 'monthly_rent', 'overdue', 'collected'] as $field) {
                $floorBuckets[$key][$field] = $this->amount($floorRow[$field]);
            }
        }
        foreach (array_keys($totals) as $field) {
            if (! in_array($field, ['contracts', 'active_contracts'], true)) {
                $totals[$field] = $this->amount($totals[$field]);
            }
        }

        $this->logReportAccess('building_statement', [
            'building_id' => $buildingId,
            'from_date' => $fromDate,
            'to_date' => $toDate,
        ]);

        return [
            'building' => [
                'id' => $building->id,
                'name' => $building->name,
                'number' => $building->number,
                'city' => $building->city,
                'district' => $building->district,
                'floors_count' => $building->floors_count,
                'units_count' => $units->count(),
            ],
            'period' => [
                'from' => $fromDate,
                'to' => $toDate,
            ],
            'counts' => $counts,
            'units' => $unitData,
            'floors' => array_values($floorBuckets),
            'contracts' => $contractRows,
            'reservations' => $reservationData,
            'totals' => $totals,
        ];
    }

    /**
     * One contract flattened for the report table, on top of the shared money rollup.
     *
     * @param  array<string, mixed>  $money
     * @return array<string, mixed>
     */
    private function contractRow(Contract $contract, array $money): array
    {
        return [
            'id' => $contract->id,
            'number' => $contract->number,
            'type' => $contract->type?->value,
            'type_label' => $contract->type?->label(),
            'status' => $contract->status?->value,
            'status_label' => $contract->status?->label(),
            'contract_date' => $contract->contract_date?->toDateString(),
            'unit_id' => $contract->unit_id,
            'unit_name' => $contract->unit?->name,
            'unit_floor' => $contract->unit?->floor?->floor_number,
            'unit_floor_display_name' => $contract->unit?->floor?->display_name,
            'client_id' => $contract->client_id,
            'client_name' => $contract->client?->name,
            'client_phone' => $contract->client?->phone,
            'monthly_rent' => $money['is_rent'] ? $this->amount($contract->monthly_rent) : 0.0,
            'security_deposit' => $money['is_rent'] ? $this->amount($contract->security_deposit) : 0.0,
            'start_date' => $money['is_rent'] ? $contract->start_date?->toDateString() : null,
            'end_date' => $money['is_rent'] ? $contract->end_date?->toDateString() : null,
            'value' => $money['value'],
            'paid' => $money['paid'],
            'remaining' => $money['remaining'],
            'overdue' => $money['overdue'],
            'due' => $money['due'],
            'installments_total' => $money['installments_total'],
            'installments_paid' => $money['installments_paid'],
            'installments_remaining' => $money['installments_remaining'],
            'down_payment' => $money['down_payment'],
            'down_payment_paid' => $money['down_payment_paid'],
            'down_payment_remaining' => $money['down_payment_remaining'],
            'installments_count' => $money['rows_count'],
            'paid_installments' => $money['paid_count'],
            'is_active' => $contract->status === ContractStatus::ACTIVE,
        ];
    }

    private function amount(mixed $value): float
    {
        return round((float) ($value ?? 0), 2);
    }
}
