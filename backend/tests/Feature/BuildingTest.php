<?php

namespace Tests\Feature;

use App\Models\Building;
use App\Models\Floor;
use App\Models\Role;
use App\Models\Unit;
use App\Models\User;
use Tests\TestCase;

class BuildingTest extends TestCase
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

        $role = Role::where('is_admin', true)->first();
        if (! $role) {
            $role = Role::create([
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
        return ['Authorization' => 'Bearer '.$token];
    }

    public function test_admin_can_create_building_with_floors(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/buildings', [
                'name' => 'العقار أ',
                'city' => 'القاهرة',
                'district' => 'مصر الجديدة',
                'type' => 'building',
                'activities' => ['residential', 'commercial'],
                'floors_count' => 5,
                'total_units' => 20,
                'has_basement' => true,
            ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.total_units', 20);

        // Check floors were auto-generated: basement (0) + 5 floors (1-5) = 6 floors
        $this->assertDatabaseCount('floors', 6);
        $this->assertDatabaseHas('floors', [
            'building_id' => $response->json('data.id'),
            'floor_number' => 0,
            'display_name' => 'بدروم',
        ]);
        $this->assertDatabaseHas('floors', [
            'building_id' => $response->json('data.id'),
            'floor_number' => 5,
            'display_name' => 'الخامس',
        ]);
    }

    public function test_building_can_be_created_without_number_and_area(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/buildings', [
                'name' => 'برج النيل',
                'city' => 'القاهرة',
                'district' => 'الزمالك',
                'type' => 'tower',
                'activities' => ['administrative'],
                'floors_count' => 10,
                'total_units' => 40,
                'has_basement' => false,
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.name', 'برج النيل')
            ->assertJsonPath('data.total_units', 40)
            ->assertJsonPath('data.number', null)
            ->assertJsonPath('data.area', null);
    }

    public function test_building_requires_city_district_floors_and_total_units(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/buildings', [
                'name' => 'ناقص',
                'type' => 'building',
                'activities' => ['residential'],
            ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['city', 'district', 'floors_count', 'total_units']);
    }

    public function test_building_without_basement_generates_floors_from_one(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/buildings', [
                'name' => 'عقار بدون بدروم',
                'city' => 'الجيزة',
                'district' => 'الدقي',
                'type' => 'building',
                'activities' => ['residential'],
                'floors_count' => 3,
                'total_units' => 12,
                'has_basement' => false,
            ]);

        $response->assertStatus(201);

        $buildingId = $response->json('data.id');

        // Only floors 1..3, no basement floor 0.
        $this->assertDatabaseCount('floors', 3);
        $this->assertDatabaseMissing('floors', [
            'building_id' => $buildingId,
            'floor_number' => 0,
        ]);
        $this->assertDatabaseHas('floors', [
            'building_id' => $buildingId,
            'floor_number' => 3,
        ]);
    }

    public function test_duplicate_activities_are_rejected(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/buildings', [
                'name' => 'نشاط مكرر',
                'city' => 'القاهرة',
                'district' => 'المعادي',
                'type' => 'building',
                'activities' => ['residential', 'residential'],
                'floors_count' => 1,
                'total_units' => 2,
            ]);

        $response->assertStatus(422);
    }

    public function test_building_requires_at_least_one_activity(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/buildings', [
                'name' => 'No Activities',
                'city' => 'القاهرة',
                'district' => 'مدينة نصر',
                'type' => 'building',
                'activities' => [],
                'floors_count' => 3,
                'total_units' => 9,
            ]);

        $response->assertStatus(422);
    }

    public function test_building_number_unique(): void
    {
        $admin = $this->createAdmin();

        $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/buildings', [
                'name' => 'Building 1',
                'number' => '1',
                'city' => 'القاهرة',
                'district' => 'مصر الجديدة',
                'type' => 'building',
                'activities' => ['residential'],
                'floors_count' => 3,
                'total_units' => 9,
            ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/buildings', [
                'name' => 'Building 2',
                'number' => '1',
                'city' => 'القاهرة',
                'district' => 'مصر الجديدة',
                'type' => 'building',
                'activities' => ['residential'],
                'floors_count' => 3,
                'total_units' => 9,
            ]);

        $response->assertStatus(422);
    }

    public function test_deleting_a_building_with_units_removes_them(): void
    {
        $admin = $this->createAdmin();

        $building = Building::create([
            'name' => 'Building With Units',
            'number' => '1',
            'type' => 'building',
            'area' => 1000.00,
            'floors_count' => 3,
        ]);

        Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 1,
        ]);

        Unit::create([
            'building_id' => $building->id,
            'floor_id' => Floor::where('building_id', $building->id)->first()->id,
            'name' => 'Unit 1',
            'type' => 'apartment',
            'activity' => 'residential',
            'area' => 100.00,
            'price_per_meter' => 5000.00,
            'status' => 'available',
        ]);

        $unitId = Unit::where('building_id', $building->id)->value('id');

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->deleteJson('/api/v1/admin/buildings/'.$building->id);

        // Deleting a building is a full, permanent cascade (see DeletionCascadeTest).
        $response->assertStatus(200);
        $response->assertJsonPath('data.deleted.units', 1);
        $this->assertDatabaseMissing('buildings', ['id' => $building->id]);
        $this->assertDatabaseMissing('units', ['id' => $unitId]);
        $this->assertDatabaseMissing('floors', ['building_id' => $building->id]);
    }

    public function test_city_district_autocomplete(): void
    {
        $admin = $this->createAdmin();

        Building::create([
            'name' => 'Building 1',
            'number' => '1',
            'type' => 'building',
            'activities' => ['residential'],
            'area' => 1000.00,
            'floors_count' => 3,
            'city' => 'القاهرة',
            'district' => 'مصر الجديدة',
        ]);

        Building::create([
            'name' => 'Building 2',
            'number' => '2',
            'type' => 'building',
            'activities' => ['residential'],
            'area' => 1000.00,
            'floors_count' => 3,
            'city' => 'القاهرة',
            'district' => 'المعادي',
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/buildings/suggestions?type=city&query=القاه');

        $response->assertStatus(200);
        $this->assertContains('القاهرة', $response->json('data'));
    }

    public function test_district_suggestions_filtered_by_city(): void
    {
        $admin = $this->createAdmin();

        Building::create([
            'name' => 'Building 1',
            'number' => '1',
            'type' => 'building',
            'area' => 1000.00,
            'floors_count' => 3,
            'city' => 'القاهرة',
            'district' => 'مصر الجديدة',
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/buildings/suggestions?type=district&city=القاهرة&query=مصر');

        $response->assertStatus(200);
        $this->assertContains('مصر الجديدة', $response->json('data'));
    }

    public function test_buildings_index_supports_server_search(): void
    {
        $admin = $this->createAdmin();
        $this->seedThreeBuildings($admin['token']);

        $headers = $this->authHeaders($admin['token']);

        // Arabic activity label → enum value.
        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/buildings?search=سكني')
            ->assertOk()
            ->assertJsonPath('meta.total', 2);

        // Arabic type label («برج» → tower) even when the name doesn't contain it.
        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/buildings?search=برج')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.name', 'ألفا');

        // City/district text.
        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/buildings?search=المعادي')
            ->assertOk()
            ->assertJsonPath('meta.total', 1);

        // Search composes with the other filters (AND, not OR).
        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/buildings?search=سكني&city=القاهرة')
            ->assertOk()
            ->assertJsonPath('meta.total', 1);
    }

    public function test_buildings_index_paginates_and_sorts_on_the_server(): void
    {
        $admin = $this->createAdmin();
        $this->seedThreeBuildings($admin['token']);

        $headers = $this->authHeaders($admin['token']);

        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/buildings?per_page=1&page=2')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.current_page', 2)
            ->assertJsonPath('meta.last_page', 3)
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('meta.from', 2)
            ->assertJsonPath('meta.to', 2);

        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/buildings?sort=total_units&dir=asc')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'مركز الشفاء')
            ->assertJsonPath('data.0.total_units', 9);

        // Unknown sort columns fall back to created_at instead of erroring.
        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/buildings?sort=not_a_column&dir=sideways')
            ->assertOk()
            ->assertJsonPath('meta.total', 3);
    }

    private function seedThreeBuildings(string $token): void
    {
        $buildings = [
            ['ألفا', 'القاهرة', 'المعادي', 'tower', ['residential'], 7, 21],
            ['عمارة السلام', 'الجيزة', 'الدقي', 'building', ['residential'], 4, 12],
            ['مركز الشفاء', 'القاهرة', 'مصر الجديدة', 'building', ['medical'], 3, 9],
        ];

        foreach ($buildings as [$name, $city, $district, $type, $activities, $floors, $units]) {
            $this->withHeaders($this->authHeaders($token))
                ->postJson('/api/v1/admin/buildings', [
                    'name' => $name,
                    'city' => $city,
                    'district' => $district,
                    'type' => $type,
                    'activities' => $activities,
                    'floors_count' => $floors,
                    'total_units' => $units,
                ])
                ->assertStatus(201);
        }
    }
}
