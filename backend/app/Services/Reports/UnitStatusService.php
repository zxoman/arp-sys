<?php

namespace App\Services\Reports;

use App\Enums\ContractStatus;
use App\Enums\ContractType;
use App\Enums\ReservationStatus;
use App\Enums\UnitStatus;
use App\Models\Contract;
use App\Models\Reservation;
use App\Models\Unit;
use Illuminate\Database\Eloquent\Collection;

/**
 * «حالة الوحدات»: every unit with its current state — available / reserved / sold / rented, plus the
 * units that are available but flagged «غير قابلة للبيع» — rolled up per status and per building.
 *
 * The state comes from `units.status` (only reservations and contracts change it). The money next to
 * a unit is what that state is worth: a sold unit carries its active contract's net price, an
 * available or reserved one its listed sale price, a rented one the active lease's monthly rent.
 *
 * The prototype's «مرتجعة» has no API state: a returned unit simply goes back to `available` once its
 * lease is cancelled, so there is no returned bucket here.
 */
class UnitStatusService extends BaseReportService
{
    /**
     * @param  array{building_id?: int|null, floor_id?: int|null, type?: string|null, purpose?: string|null}  $filters
     */
    public function generate(array $filters = []): array
    {
        $units = Unit::query()
            ->with(['building', 'floor'])
            ->when($filters['building_id'] ?? null, fn ($q, $id) => $q->where('building_id', $id))
            ->when($filters['floor_id'] ?? null, fn ($q, $id) => $q->where('floor_id', $id))
            ->when($filters['type'] ?? null, fn ($q, $type) => $q->where('type', $type))
            ->when($filters['purpose'] ?? null, fn ($q, $purpose) => $q->where('purpose', $purpose))
            ->orderBy('building_id')
            ->orderBy('floor_id')
            ->orderBy('name')
            ->get();

        // One open contract / reservation per unit: the latest one, because a unit may have older
        // cancelled history behind it.
        $contracts = $this->latestPerUnit(
            Contract::query()
                ->whereIn('unit_id', $units->pluck('id'))
                ->where('status', ContractStatus::ACTIVE->value)
                ->with(['client'])
                ->orderBy('contract_date')
                ->orderBy('id')
                ->get()
        );

        $reservations = $this->latestPerUnit(
            Reservation::query()
                ->whereIn('unit_id', $units->pluck('id'))
                ->where('status', ReservationStatus::ACTIVE->value)
                ->with(['client', 'payments'])
                ->orderBy('reservation_date')
                ->orderBy('id')
                ->get()
        );

        $counts = ['total' => 0, 'available' => 0, 'reserved' => 0, 'sold' => 0, 'rented' => 0, 'closed' => 0];
        $totals = ['units' => 0, 'area' => 0.0, 'sale_area' => 0.0, 'sale_value' => 0.0, 'monthly_rent' => 0.0];
        $buildings = [];
        $rows = [];

        foreach ($units as $unit) {
            $status = $unit->status?->value;
            // A unit that cannot be sold is «مغلقة» rather than «متاحة» (same rule as the statements).
            $closed = ! $unit->is_sellable && $status === UnitStatus::AVAILABLE->value;
            $contract = $contracts->get($unit->id);
            $reservation = $reservations->get($unit->id);
            $isRent = $contract?->type === ContractType::RENT;

            $area = $this->amount($unit->area);
            $listedPrice = $this->amount($unit->total_price);
            $saleValue = $contract !== null && $status === UnitStatus::SOLD->value
                ? $this->amount($contract->total_price)
                : $listedPrice;
            $monthlyRent = $isRent ? $this->amount($contract->monthly_rent) : 0.0;
            $client = $contract?->client ?? $reservation?->client;

            $counts['total']++;
            $counts[$closed ? 'closed' : ($status ?? 'available')] = ($counts[$closed ? 'closed' : ($status ?? 'available')] ?? 0) + 1;

            $totals['units']++;
            $totals['area'] += $area;
            $totals['sale_value'] += $unit->offersSale() ? $saleValue : 0.0;
            $totals['sale_area'] += $unit->offersSale() ? $area : 0.0;
            $totals['monthly_rent'] += $monthlyRent;

            $buildingId = (int) $unit->building_id;
            $buildings[$buildingId] ??= [
                'id' => $buildingId,
                'name' => $unit->building?->name,
                'number' => $unit->building?->number,
                'total' => 0,
                'available' => 0,
                'reserved' => 0,
                'sold' => 0,
                'rented' => 0,
                'closed' => 0,
                'area' => 0.0,
                'sale_value' => 0.0,
                'monthly_rent' => 0.0,
            ];
            $bucket = $closed ? 'closed' : ($status ?? 'available');
            $buildings[$buildingId]['total']++;
            $buildings[$buildingId][$bucket]++;
            $buildings[$buildingId]['area'] += $area;
            $buildings[$buildingId]['sale_value'] += $unit->offersSale() ? $saleValue : 0.0;
            $buildings[$buildingId]['monthly_rent'] += $monthlyRent;

            $rows[] = [
                'id' => $unit->id,
                'name' => $unit->name,
                'building_id' => $buildingId,
                'building_name' => $unit->building?->name,
                'floor' => $unit->floor?->floor_number,
                'floor_display_name' => $unit->floor?->display_name,
                'type' => $unit->type?->value,
                'type_label' => $unit->type?->label(),
                'purpose' => $unit->purpose?->value,
                'purpose_label' => $unit->purpose?->label(),
                'area' => $area,
                'rooms' => $unit->rooms,
                'bathrooms' => $unit->bathrooms,
                'price_per_meter' => $unit->price_per_meter === null ? null : $this->amount($unit->price_per_meter),
                // The listed price, or the contract's net price once the unit is sold.
                'sale_price' => $unit->offersSale() ? $saleValue : null,
                'status' => $status,
                'status_label' => $unit->status?->label(),
                'is_sellable' => (bool) $unit->is_sellable,
                'non_sellable_reason' => $unit->non_sellable_reason,
                'is_closed' => $closed,
                'client_id' => $client?->id,
                'client_name' => $client?->name,
                'contract_id' => $contract?->id,
                'contract_number' => $contract?->number,
                'contract_type' => $contract?->type?->value,
                // Only a live lease has a monthly rent; a sale has none.
                'monthly_rent' => $isRent ? $monthlyRent : null,
                'contract_end_date' => $isRent ? $contract?->end_date?->toDateString() : null,
                'reservation_date' => $reservation?->reservation_date?->toDateString(),
                'deposit_paid' => $reservation === null ? 0.0 : $this->amount($reservation->deposit_paid),
            ];
        }

        foreach ($buildings as $key => $row) {
            foreach (['area', 'sale_value', 'monthly_rent'] as $field) {
                $buildings[$key][$field] = $this->amount($row[$field]);
            }
        }
        foreach (['area', 'sale_area', 'sale_value', 'monthly_rent'] as $field) {
            $totals[$field] = $this->amount($totals[$field]);
        }

        $this->logReportAccess('unit_status', $filters);

        return [
            'filters' => $filters,
            'counts' => $counts,
            'totals' => $totals,
            'by_building' => array_values($buildings),
            'units' => $rows,
        ];
    }

    /**
     * The newest item of every unit — the open contract / reservation a unit currently sits on.
     * The queries are ordered oldest-first, so `keyBy` keeps the last (latest) row of each unit.
     *
     * @template T of \Illuminate\Database\Eloquent\Model
     *
     * @param  Collection<int, T>  $items
     * @return \Illuminate\Support\Collection<int, T>
     */
    private function latestPerUnit(Collection $items)
    {
        return $items->keyBy('unit_id');
    }

    private function amount(mixed $value): float
    {
        return round((float) ($value ?? 0), 2);
    }
}
