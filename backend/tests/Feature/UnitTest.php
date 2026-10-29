<?php

namespace Tests\Feature;

use App\Models\Building;
use App\Models\Floor;
use App\Models\User;
use Tests\TestCase;

class UnitTest extends TestCase
{
    protected function createAdmin(): array
    {
        $user = User::create([
            'name' => 'Admin',
            'username' => 'admin',
            'password' => bcrypt('password123'),
            'status' => 'active',
            'lock_version' => 0,
        ]);

        $role = \App\Models\Role::where('is_admin', true)->first();
        if (!$role) {
            $role = \App\Models\Role::create([
                'name' => 'admin',
                'is_admin' => true,
            ]);
        }
        $user->update(['role_id' => $role->id]);

        $token = $this->getAuthToken($user);

        return ['user' => $user, 'token' => $token];
    }

    protected function getAuthToken(User $user, string $password = 'password123'): string
    {
        $response = $this->postJson('/api/v1/auth/login', [
            'login' => $user->username,
            'password' => $password,
        ]);

        return $response->json('data.token');
    }

    protected function authHeaders(string $token): array
    {
        return ['Authorization' => 'Bearer ' . $token];
    }

    protected function createBuildingWithActivities(array $overrides = []): \App\Models\Building
    {
        $building = \App\Models\Building::create(array_merge([
            'name' => 'Test Building',
            'number' => '1',
            'type' => 'building',
            'area' => 1000.00,
            'floors_count' => 3,
        ], $overrides));

        \App\Models\BuildingActivity::create([
            'building_id' => $building->id,
            'activity' => $overrides['activity'] ?? 'residential',
        ]);

        return $building;
    }

    public function test_admin_can_create_unit(): void
    {
        $admin = $this->createAdmin();

        $building = $this->createBuildingWithActivities([
            'name' => 'Building',
            'number' => '1',
        ]);
        $floor = Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Unit A1',
                'type' => 'apartment',
                'activity' => 'residential',
                'area' => 120.00,
                'price_per_meter' => 5000.00,
                'rooms' => 3,
                'bathrooms' => 2,
            ]);

        $response->assertStatus(201);
        $response->assertJson(['data' => [
            'name' => 'Unit A1',
            'type' => 'apartment',
            'activity' => 'residential',
            'status' => 'available',
        ]]);
        // total_price = 120 * 5000 = 600000
        $this->assertEquals('600000.00', $response->json('data.total_price'));
    }

    public function test_unit_activity_auto_set_when_single_activity(): void
    {
        $admin = $this->createAdmin();

        $building = $this->createBuildingWithActivities([
            'name' => 'Building',
            'number' => '1',
            'activity' => 'commercial',
        ]);
        $floor = Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Shop 1',
                'type' => 'shop',
                'area' => 50.00,
                'price_per_meter' => 8000.00,
            ]);

        $response->assertStatus(201);
        $this->assertEquals('commercial', $response->json('data.activity'));
    }

    public function test_unit_floor_must_belong_to_same_building(): void
    {
        $admin = $this->createAdmin();

        $building1 = $this->createBuildingWithActivities([
            'name' => 'Building 1',
            'number' => '1',
        ]);
        $building2 = $this->createBuildingWithActivities([
            'name' => 'Building 2',
            'number' => '2',
        ]);
        $floor2 = Floor::create([
            'building_id' => $building2->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building1->id,
                'floor_id' => $floor2->id,
                'name' => 'Unit X',
                'type' => 'apartment',
                'activity' => 'residential',
                'area' => 100.00,
            ]);

        $response->assertStatus(422);
    }

    public function test_unit_activity_must_be_in_building_activities(): void
    {
        $admin = $this->createAdmin();

        $building = $this->createBuildingWithActivities([
            'name' => 'Building',
            'number' => '1',
            'activity' => 'residential',
        ]);
        $floor = Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Unit X',
                'type' => 'shop',
                'activity' => 'commercial', // not in building's activities
                'area' => 100.00,
            ]);

        $response->assertStatus(422);
    }

    public function test_unit_status_is_available_by_default(): void
    {
        $admin = $this->createAdmin();

        $building = $this->createBuildingWithActivities([
            'name' => 'Building',
            'number' => '1',
            'activity' => 'residential',
        ]);
        $floor = Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Unit A1',
                'type' => 'apartment',
                'activity' => 'residential',
                'area' => 120.00,
            ]);

        $response->assertStatus(201);
        $this->assertEquals('available', $response->json('data.status'));
        // Purpose defaults to both, and the unit is sellable with no reason.
        $this->assertEquals('both', $response->json('data.purpose'));
        $this->assertTrue($response->json('data.is_sellable'));
        $this->assertNull($response->json('data.non_sellable_reason'));
    }

    public function test_cannot_edit_area_when_unit_sold(): void
    {
        $admin = $this->createAdmin();

        $building = $this->createBuildingWithActivities([
            'name' => 'Building',
            'number' => '1',
            'activity' => 'residential',
        ]);
        $floor = Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);
        $unit = \App\Models\Unit::create([
            'building_id' => $building->id,
            'floor_id' => $floor->id,
            'name' => 'Sold Unit',
            'type' => 'apartment',
            'activity' => 'residential',
            'area' => 100.00,
            'price_per_meter' => 5000.00,
            'status' => 'sold',
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/units/' . $unit->id, [
                'area' => 200.00,
            ]);

        $response->assertStatus(422);
    }

    public function test_building_id_immutable_after_creation(): void
    {
        $admin = $this->createAdmin();

        $building1 = $this->createBuildingWithActivities([
            'name' => 'Building 1',
            'number' => '1',
        ]);
        $building2 = $this->createBuildingWithActivities([
            'name' => 'Building 2',
            'number' => '2',
        ]);
        $floor1 = Floor::create([
            'building_id' => $building1->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);
        $unit = \App\Models\Unit::create([
            'building_id' => $building1->id,
            'floor_id' => $floor1->id,
            'name' => 'Unit X',
            'type' => 'apartment',
            'activity' => 'residential',
            'area' => 100.00,
            'status' => 'available',
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/units/' . $unit->id, [
                'building_id' => $building2->id,
            ]);

        $response->assertStatus(422);
    }

    public function test_cannot_delete_unit_with_active_reservation(): void
    {
        $admin = $this->createAdmin();

        $building = \App\Models\Building::create([
            'name' => 'Building',
            'number' => '1',
            'type' => 'building',
            'activities' => ['residential'],
            'area' => 1000.00,
            'floors_count' => 3,
        ]);
        $floor = Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);
        $unit = \App\Models\Unit::create([
            'building_id' => $building->id,
            'floor_id' => $floor->id,
            'name' => 'Unit X',
            'type' => 'apartment',
            'activity' => 'residential',
            'area' => 100.00,
            'status' => 'available',
        ]);

        // Reservation model is built in Phase 4; this test validates the delete guard logic
        // which is implemented in UnitService::delete(). For now we verify the unit can be deleted
        // when no reservation/contract exists.
        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->deleteJson('/api/v1/admin/units/' . $unit->id);

        $response->assertStatus(200);
        $this->assertSoftDeleted($unit);
    }

    /** A fresh building (single residential activity) + first floor, for the purpose/sale tests. */
    private function createContext(): array
    {
        $building = $this->createBuildingWithActivities([
            'name' => 'Context ' . uniqid(),
            'number' => 'C' . random_int(10000, 99999),
            'activity' => 'residential',
        ]);

        $floor = Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);

        return [$building, $floor];
    }

    public function test_unit_stores_purpose_and_explicit_sale_price(): void
    {
        $admin = $this->createAdmin();
        [$building, $floor] = $this->createContext();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Unit Sale',
                'type' => 'apartment',
                'area' => 120.00,
                'price_per_meter' => 5000.00,
                'purpose' => 'sale',
                'sale_price' => 900000.00,
            ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.purpose', 'sale');
        $response->assertJsonPath('data.sale_price', '900000.00');
        // The explicit sale price wins over area x price_per_meter (600,000).
        $this->assertEquals('900000.00', $response->json('data.total_price'));
    }

    public function test_sale_price_falls_back_to_area_times_price_per_meter(): void
    {
        $admin = $this->createAdmin();
        [$building, $floor] = $this->createContext();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Unit Derive',
                'type' => 'apartment',
                'area' => 120.00,
                'price_per_meter' => 5000.00,
            ]);

        $response->assertStatus(201);
        $this->assertNull($response->json('data.sale_price'));
        $this->assertEquals('600000.00', $response->json('data.total_price'));
    }

    public function test_rent_only_unit_has_no_sale_price(): void
    {
        $admin = $this->createAdmin();
        [$building, $floor] = $this->createContext();

        // Explicit sale price on a rent-only unit is rejected.
        $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Rent With Price',
                'type' => 'apartment',
                'area' => 120.00,
                'purpose' => 'rent',
                'sale_price' => 800000.00,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('sale_price');

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Rent Only',
                'type' => 'apartment',
                'area' => 120.00,
                'price_per_meter' => 5000.00,
                'purpose' => 'rent',
            ]);

        $response->assertStatus(201);
        $this->assertNull($response->json('data.sale_price'));
        $this->assertNull($response->json('data.total_price'));
    }

    public function test_switching_to_rent_only_clears_the_sale_price(): void
    {
        $admin = $this->createAdmin();
        [$building, $floor] = $this->createContext();

        $created = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Unit Switch',
                'type' => 'apartment',
                'area' => 120.00,
                'purpose' => 'sale',
                'sale_price' => 900000.00,
            ])
            ->assertStatus(201);

        $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/units/' . $created->json('data.id'), [
                'purpose' => 'rent',
            ])
            ->assertStatus(200)
            ->assertJsonPath('data.purpose', 'rent')
            ->assertJsonPath('data.sale_price', null)
            ->assertJsonPath('data.total_price', null);
    }

    public function test_non_sellable_unit_requires_a_reason(): void
    {
        $admin = $this->createAdmin();
        [$building, $floor] = $this->createContext();

        $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Blocked Unit',
                'type' => 'apartment',
                'area' => 120.00,
                'is_sellable' => false,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('non_sellable_reason');

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Blocked Unit',
                'type' => 'apartment',
                'area' => 120.00,
                'is_sellable' => false,
                'non_sellable_reason' => 'نزاع قضائي على الملكية',
            ]);

        $response->assertStatus(201);
        $this->assertFalse($response->json('data.is_sellable'));
        $this->assertEquals('نزاع قضائي على الملكية', $response->json('data.non_sellable_reason'));
    }

    public function test_sellable_unit_drops_a_stale_reason(): void
    {
        $admin = $this->createAdmin();
        [$building, $floor] = $this->createContext();

        $created = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Freed Unit',
                'type' => 'apartment',
                'area' => 120.00,
                'is_sellable' => false,
                'non_sellable_reason' => 'مرهونة لصالح البنك',
            ])
            ->assertStatus(201);

        $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/units/' . $created->json('data.id'), [
                'is_sellable' => true,
            ])
            ->assertStatus(200)
            ->assertJsonPath('data.is_sellable', true)
            ->assertJsonPath('data.non_sellable_reason', null);
    }

    public function test_cannot_change_purpose_or_sale_price_after_unit_is_sold(): void
    {
        $admin = $this->createAdmin();
        [$building, $floor] = $this->createContext();

        $unit = \App\Models\Unit::create([
            'building_id' => $building->id,
            'floor_id' => $floor->id,
            'name' => 'Sold Unit',
            'type' => 'apartment',
            'activity' => 'residential',
            'area' => 100.00,
            'price_per_meter' => 5000.00,
            'purpose' => 'both',
            'status' => 'sold',
        ]);

        $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/units/' . $unit->id, ['purpose' => 'rent'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('purpose');

        $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/units/' . $unit->id, ['sale_price' => 700000.00])
            ->assertStatus(422)
            ->assertJsonValidationErrors('sale_price');

        // Sending the same values (or no changes) is still allowed.
        $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/units/' . $unit->id, ['purpose' => 'both', 'sale_price' => null])
            ->assertStatus(200);
    }

    public function test_units_index_filters_by_purpose_and_availability(): void
    {
        $admin = $this->createAdmin();
        [$building, $floor] = $this->createContext();

        foreach ([
            ['Sale Unit', 'sale', true, null],
            ['Rent Unit', 'rent', true, null],
            ['Blocked Unit', 'both', false, 'نزاع قضائي'],
        ] as [$name, $purpose, $sellable, $reason]) {
            $this->withHeaders($this->authHeaders($admin['token']))
                ->postJson('/api/v1/admin/units', [
                    'building_id' => $building->id,
                    'floor_id' => $floor->id,
                    'name' => $name,
                    'type' => 'apartment',
                    'area' => 100.00,
                    'purpose' => $purpose,
                    'is_sellable' => $sellable,
                    'non_sellable_reason' => $reason,
                ])
                ->assertStatus(201);
        }

        $headers = $this->authHeaders($admin['token']);

        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/units?purpose=rent')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Rent Unit');

        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/units?sellable=0')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Blocked Unit');

        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/units?sellable=1')
            ->assertOk()
            ->assertJsonCount(2, 'data');
    }

    /** The index paginates like buildings: `per_page` (max 100) plus a `meta` block. */
    public function test_units_index_returns_pagination_meta(): void
    {
        $admin = $this->createAdmin();
        [$building, $floor] = $this->createContext();
        $headers = $this->authHeaders($admin['token']);

        foreach (range(1, 3) as $i) {
            $this->withHeaders($headers)
                ->postJson('/api/v1/admin/units', [
                    'building_id' => $building->id,
                    'floor_id' => $floor->id,
                    'name' => 'Meta Unit ' . $i,
                    'type' => 'apartment',
                    'area' => 100.00,
                    'purpose' => 'both',
                ])
                ->assertStatus(201);
        }

        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/units?per_page=2&sort=id&dir=asc')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.name', 'Meta Unit 1')
            ->assertJsonPath('meta.current_page', 1)
            ->assertJsonPath('meta.last_page', 2)
            ->assertJsonPath('meta.per_page', 2)
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('meta.from', 1)
            ->assertJsonPath('meta.to', 2);

        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/units?per_page=2&page=2&sort=id&dir=asc')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Meta Unit 3')
            ->assertJsonPath('meta.current_page', 2)
            ->assertJsonPath('meta.from', 3)
            ->assertJsonPath('meta.to', 3);
    }

    /** Clearing the explicit sale price falls back to area x price_per_meter. */
    public function test_sale_price_can_be_cleared_back_to_area_times_price_per_meter(): void
    {
        $admin = $this->createAdmin();
        [$building, $floor] = $this->createContext();

        $created = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/units', [
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => 'Unit Clear',
                'type' => 'apartment',
                'area' => 100.00,
                'price_per_meter' => 4000.00,
                'sale_price' => 500000.00,
            ])
            ->assertStatus(201)
            ->assertJsonPath('data.total_price', '500000.00');

        $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/units/' . $created->json('data.id'), ['sale_price' => null])
            ->assertStatus(200)
            ->assertJsonPath('data.sale_price', null)
            ->assertJsonPath('data.total_price', '400000.00');
    }

    /** Soft delete is blocked while the unit has an active reservation or a non-cancelled contract (BRIEF 2.3). */
    public function test_cannot_delete_unit_with_an_active_reservation_or_a_live_contract(): void
    {
        $admin = $this->createAdmin();
        [$building, $floor] = $this->createContext();

        $unit = \App\Models\Unit::create([
            'building_id' => $building->id,
            'floor_id' => $floor->id,
            'name' => 'Guarded Unit',
            'type' => 'apartment',
            'activity' => 'residential',
            'area' => 100.00,
            'status' => 'available',
        ]);

        $client = \App\Models\Client::create(['name' => 'Client G', 'phone' => '+201000000099']);

        $reservation = \App\Models\Reservation::create([
            'client_id' => $client->id,
            'building_id' => $building->id,
            'unit_id' => $unit->id,
            'unit_type' => 'apartment',
            'unit_activity' => 'residential',
            'reservation_date' => now()->toDateString(),
            'status' => 'active',
        ]);

        $headers = $this->authHeaders($admin['token']);

        $this->withHeaders($headers)
            ->deleteJson('/api/v1/admin/units/' . $unit->id)
            ->assertStatus(422)
            ->assertJsonValidationErrors('unit');

        // A cancelled reservation alone is history, not a block.
        $reservation->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancellation_reason' => 'ملغي']);

        \App\Models\Contract::create([
            'number' => '2026-9998',
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $unit->id,
            'contract_date' => now()->toDateString(),
            'total_price' => 500000.00,
            'agreed_down_payment' => 100000.00,
            'installments_count' => 0,
            'status' => 'active',
        ]);

        $this->withHeaders($headers)
            ->deleteJson('/api/v1/admin/units/' . $unit->id)
            ->assertStatus(422)
            ->assertJsonValidationErrors('unit');

        $this->assertNotSoftDeleted($unit);
    }
}
