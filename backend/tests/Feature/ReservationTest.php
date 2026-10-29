<?php

namespace Tests\Feature;

use App\Models\Building;
use App\Models\Client;
use App\Models\Floor;
use App\Models\Reservation;
use App\Models\ReservationPayment;
use App\Models\User;
use Tests\TestCase;

class ReservationTest extends TestCase
{
    protected function createAdmin(): array
    {
        $role = \App\Models\Role::create([
            'name' => 'admin',
            'is_admin' => true,
        ]);

        // Attach all fixed permissions to admin role
        foreach (\App\Enums\Permission::all() as $permission) {
            \App\Models\RolePermission::firstOrCreate([
                'role_id' => $role->id,
                'permission' => $permission,
            ]);
        }

        $user = User::create([
            'name' => 'Admin',
            'username' => 'admin',
            'password' => bcrypt('password123'),
            'role_id' => $role->id,
            'status' => 'active',
            'lock_version' => 0,
        ]);

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

    protected function createBuildingAndUnit(array $overrides = []): array
    {

        $building = Building::create([
            'name' => 'Test Building',
            'number' => '1',
            'type' => 'building',
            'area' => 2000.00,
            'floors_count' => 5,
            'has_basement' => false,
        ]);

        \App\Models\BuildingActivity::create([
            'building_id' => $building->id,
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
            'name' => 'Unit 101',
            'type' => 'apartment',
            'activity' => 'residential',
            'area' => 120.00,
            'price_per_meter' => 5000.00,
            'status' => 'available',
        ]);

        return ['building' => $building, 'floor' => $floor, 'unit' => $unit];
    }

    public function test_admin_can_create_reservation_with_unit(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('reservations', [
            'client_id' => $client->id,
            'status' => 'active',
        ]);
        // A reservation carries no price: the price is agreed at contract time.
        $this->assertArrayNotHasKey('unit_price', $response->json('data'));
        $this->assertEquals('0.00', $response->json('data.deposit_paid'));
        // Unit status should become reserved
        $this->assertDatabaseHas('units', ['id' => $data['unit']->id, 'status' => 'reserved']);
    }

    public function test_cannot_create_two_active_reservations_on_same_unit(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
            ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
            ]);

        $response->assertStatus(422);
    }

    public function test_can_create_reservation_with_first_payment(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
                'first_payment' => [
                    'amount' => 100000.00,
                    'paid_at' => now()->toDateString(),
                ],
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('reservation_payments', [
            'reservation_id' => $response->json('data.id'),
            'amount' => '100000.00',
        ]);
        $this->assertEquals('100000.00', $response->json('data.deposit_paid'));
    }

    public function test_can_add_payment_to_reservation(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $reservation = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
            ])->json('data');

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations/' . $reservation['id'] . '/payments', [
                'amount' => 100000.00,
                'paid_at' => now()->toDateString(),
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('reservation_payments', [
            'reservation_id' => $reservation['id'],
            'amount' => '100000.00',
        ]);
    }

    public function test_payment_without_paid_at_defaults_to_today(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $reservation = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
            ])->json('data');

        // `paid_at` is optional (the front sends only the amount).
        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations/' . $reservation['id'] . '/payments', [
                'amount' => 250.00,
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('reservation_payments', [
            'reservation_id' => $reservation['id'],
            'amount' => '250.00',
            'paid_at' => now()->toDateString() . ' 00:00:00',
        ]);
    }

    public function test_reservation_payments_have_no_price_ceiling(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $reservation = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
            ])->json('data');

        // A reservation has no agreed price, so deposits are only summed — never capped.
        foreach ([500000.00, 200000.00] as $amount) {
            $this->withHeaders($this->authHeaders($admin['token']))
                ->postJson('/api/v1/admin/reservations/' . $reservation['id'] . '/payments', [
                    'amount' => $amount,
                    'paid_at' => now()->toDateString(),
                ])
                ->assertStatus(201);
        }

        $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/reservations/' . $reservation['id'] . '/payments')
            ->assertOk()
            ->assertJsonPath('meta.deposit_paid', '700000.00');
    }

    public function test_can_cancel_reservation(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $reservation = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
            ])->json('data');

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations/' . $reservation['id'] . '/cancel', [
                'cancellation_reason' => 'Client changed mind',
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('reservations', [
            'id' => $reservation['id'],
            'status' => 'cancelled',
        ]);
        // Unit should return to available
        $this->assertDatabaseHas('units', ['id' => $data['unit']->id, 'status' => 'available']);
    }

    public function test_can_convert_reservation(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $reservation = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
            ])->json('data');

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations/' . $reservation['id'] . '/convert');

        $response->assertStatus(200);
        $this->assertEquals($reservation['id'], $response->json('data.reservation_id'));
        $this->assertEquals($client->id, $response->json('data.client_id'));
        $this->assertEquals($data['unit']->id, $response->json('data.unit_id'));
        // Neither a price nor a price suggestion: the contract screen asks for the agreed price.
        $this->assertArrayNotHasKey('unit_price', $response->json('data'));
        $this->assertArrayNotHasKey('suggested_price', $response->json('data'));
    }

    public function test_non_admin_cannot_access_reservations(): void
    {
        $user = User::create([
            'name' => 'Regular',
            'username' => 'regular',
            'password' => bcrypt('password123'),
            'status' => 'active',
            'lock_version' => 0,
        ]);

        $token = $this->getAuthToken($user);

        $response = $this->withHeaders($this->authHeaders($token))
            ->getJson('/api/v1/admin/reservations');

        $response->assertStatus(403);
    }

    public function test_login_works(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/auth/me');

        $response->assertStatus(200);
        $this->assertEquals('admin', $response->json('data.username'));
    }

    public function test_cannot_reserve_a_unit_that_is_not_sellable(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $data['unit']->update([
            'is_sellable' => false,
            'non_sellable_reason' => 'نزاع قضائي على الملكية',
        ]);

        $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('unit_id');
    }

    public function test_reservation_needs_no_price_even_for_a_rent_only_unit(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $data['unit']->update(['purpose' => 'rent']);

        // The reservation records no price at all; a rent value is entered with the contract.
        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
            ]);

        $response->assertStatus(201);
        $this->assertArrayNotHasKey('unit_price', $response->json('data'));
    }

    public function test_can_create_building_level_reservation_without_a_unit(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'building_id' => $data['building']->id,
                'reservation_date' => now()->toDateString(),
            ]);

        // unit_type / unit_activity are nullable for a general reservation (no unit to copy them from).
        $response->assertStatus(201);
        $this->assertNull($response->json('data.unit_type'));
        $this->assertNull($response->json('data.unit_activity'));
        $this->assertDatabaseHas('reservations', [
            'id' => $response->json('data.id'),
            'building_id' => $data['building']->id,
            'unit_id' => null,
            'status' => 'active',
        ]);
    }

    public function test_reservation_payment_can_be_cancelled(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $reservation = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
                'first_payment' => [
                    'amount' => 100000.00,
                    'paid_at' => now()->toDateString(),
                ],
            ])->json('data');

        $payment = ReservationPayment::where('reservation_id', $reservation['id'])->first();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/reservations/' . $reservation['id'] . '/payments/' . $payment->id . '/cancel', [
                'cancel_reason' => 'Error in payment',
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('reservation_payments', [
            'id' => $payment->id,
            'status' => 'cancelled',
        ]);
    }
}