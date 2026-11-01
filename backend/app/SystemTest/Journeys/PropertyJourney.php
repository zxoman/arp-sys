<?php

namespace App\SystemTest\Journeys;

use App\SystemTest\Journey;
use App\SystemTest\JourneyResult;

/** Buildings → floors → units, including editing every field and the search/filter contract. */
class PropertyJourney extends Journey
{
    public function __construct()
    {
        parent::__construct('Buildings & units');
    }

    public function run(): JourneyResult
    {
        if (! $this->login()) {
            return $this->result;
        }

        $building = $this->post('/api/v1/admin/buildings', [
            'name' => 'برج الاختبار',
            'city' => 'القاهرة',
            'district' => 'المعادي',
            'type' => 'tower',
            'activities' => ['residential', 'commercial'],
            'floors_count' => 2,
            'total_units' => 4,
            'has_basement' => false,
        ]);
        if (! $this->expect($building, 201, 'create building')) {
            return $this->result;
        }
        $buildingId = (int) data_get($building['json'], 'data.id');

        // Required fields are enforced.
        $this->expect(
            $this->post('/api/v1/admin/buildings', ['name' => 'ناقص']),
            422,
            'building without city/district is refused'
        );

        $this->expect($this->get('/api/v1/admin/buildings?search='.urlencode('برج الاختبار')), 200, 'search buildings', 'meta.total', 1);
        $this->expect($this->get("/api/v1/admin/buildings/{$buildingId}"), 200, 'show building', 'data.name', 'برج الاختبار');

        $detail = $this->get("/api/v1/admin/buildings/{$buildingId}");
        $floors = (array) data_get($detail['json'], 'data.floors', []);
        $this->assert(count($floors), 2, 'building has two floors');
        $floorId = (int) ($floors[0]['id'] ?? 0);

        $unit = $this->post('/api/v1/admin/units', [
            'building_id' => $buildingId,
            'floor_id' => $floorId,
            'name' => 'شقة 101',
            'type' => 'apartment',
            'activity' => 'residential',
            'area' => 120,
            'price_per_meter' => 15000,
            'rooms' => 3,
            'bathrooms' => 2,
        ]);
        if (! $this->expect($unit, 201, 'create unit')) {
            return $this->result;
        }
        $unitId = (int) data_get($unit['json'], 'data.id');
        $this->expect($unit, 201, 'new unit is available', 'data.status', 'available');

        // The owner's rule (2026-11-01): every field is editable, area and price_per_meter included,
        // and that must also hold once the unit is sold or rented.
        $edited = $this->put("/api/v1/admin/units/{$unitId}", [
            'area' => 135,
            'price_per_meter' => 16000,
            'rooms' => 4,
            'bathrooms' => 3,
            'name' => 'شقة 101 (معدلة)',
        ]);
        $this->expect($edited, 200, 'edit area and price per meter');
        $this->assert((float) data_get($edited['json'], 'data.area'), 135.0, 'area really changed');
        $this->assert((float) data_get($edited['json'], 'data.price_per_meter'), 16000.0, 'price per meter changed');

        // Purpose switches and the sale price are editable too.
        $rent = $this->put("/api/v1/admin/units/{$unitId}", ['purpose' => 'rent']);
        $this->expect($rent, 200, 'switch unit to rent-only');
        $this->assert(data_get($rent['json'], 'data.sale_price'), null, 'rent-only clears the sale price');

        $sell = $this->put("/api/v1/admin/units/{$unitId}", ['purpose' => 'sale', 'sale_price' => 2000000]);
        $this->expect($sell, 200, 'switch back to sale with a price');
        $this->assert((float) data_get($sell['json'], 'data.sale_price'), 2000000.0, 'sale price stored');

        $this->expect($this->get('/api/v1/admin/units?building_id='.$buildingId), 200, 'filter units by building', 'meta.total', 1);

        // A unit cannot move to another building.
        $this->expect(
            $this->put("/api/v1/admin/units/{$unitId}", ['building_id' => $buildingId + 999]),
            422,
            'building_id stays immutable'
        );

        // Clean up so later journeys start from a known place.
        $this->expect($this->delete("/api/v1/admin/units/{$unitId}"), 200, 'delete the test unit');
        $this->expect($this->delete("/api/v1/admin/buildings/{$buildingId}"), 200, 'delete the test building');

        return $this->result;
    }
}
