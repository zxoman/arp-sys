<?php

namespace Tests\Feature;

use App\Models\Building;
use App\Models\Client;
use App\Models\Contract;
use App\Models\Floor;
use App\Models\Installment;
use App\Models\Reservation;
use App\Models\ReservationPayment;
use App\Models\Unit;
use App\Models\User;
use Tests\TestCase;

class ReportTest extends TestCase
{
    protected function createAdmin(): array
    {
        $role = \App\Models\Role::create([
            'name' => 'admin',
            'is_admin' => true,
        ]);

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

    protected function createFullSetup(): array
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

        $client = Client::create([
            'name' => 'Test Client',
            'phone' => '+201000000001',
        ]);

        return [
            'building' => $building,
            'unit' => $unit,
            'client' => $client,
        ];
    }

    public function test_customer_statement(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createFullSetup();

        // Create a reservation with payment
        $reservation = Reservation::create([
            'client_id' => $data['client']->id,
            'building_id' => $data['building']->id,
            'unit_id' => $data['unit']->id,
            'unit_type' => 'apartment',
            'unit_activity' => 'residential',
            'reservation_date' => '2026-01-01',
            'status' => 'active',
        ]);

        ReservationPayment::create([
            'reservation_id' => $reservation->id,
            'amount' => 100000.00,
            'paid_at' => '2026-01-15',
            'status' => 'valid',
            'created_by' => $admin['user']->id,
        ]);

        // Create a contract
        $contract = Contract::create([
            'number' => '2026-0001',
            'reservation_id' => $reservation->id,
            'type' => 'sale',
            'client_id' => $data['client']->id,
            'unit_id' => $data['unit']->id,
            'contract_date' => '2026-02-01',
            'total_price' => 600000.00,
            'agreed_down_payment' => 100000.00,
            'installments_count' => 2,
            'first_installment_date' => '2026-03-01',
            'interval_months' => 1,
            'status' => 'active',
        ]);

        Installment::create([
            'contract_id' => $contract->id,
            'sequence_number' => 1,
            'due_date' => '2026-03-01',
            'amount' => 250000.00,
            'paid_amount' => 50000.00,
            'remaining' => 200000.00,
            'status' => 'partially_paid',
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/reports/customer-statement?client_id=' . $data['client']->id . '&from_date=2026-01-01&to_date=2026-12-31');

        $response->assertStatus(200);
        $this->assertArrayHasKey('client', $response->json('data'));
        $this->assertArrayHasKey('reservations', $response->json('data'));
        $this->assertArrayHasKey('contracts', $response->json('data'));
        $this->assertArrayHasKey('payments', $response->json('data'));
        $this->assertArrayHasKey('totals', $response->json('data'));
    }


    public function test_building_statement(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createFullSetup();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/reports/building-statement?building_id=' . $data['building']->id . '&from_date=2026-01-01&to_date=2026-12-31');

        $response->assertStatus(200);
        $this->assertArrayHasKey('building', $response->json('data'));
        $this->assertArrayHasKey('units', $response->json('data'));
        $this->assertArrayHasKey('floors', $response->json('data'));
        $this->assertArrayHasKey('contracts', $response->json('data'));
        $this->assertArrayHasKey('totals', $response->json('data'));
    }

    public function test_unit_statement(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createFullSetup();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/reports/unit-statement?unit_id=' . $data['unit']->id . '&from_date=2026-01-01&to_date=2026-12-31');

        $response->assertStatus(200);
        $this->assertArrayHasKey('unit', $response->json('data'));
        $this->assertArrayHasKey('reservations', $response->json('data'));
        $this->assertArrayHasKey('contracts', $response->json('data'));
        $this->assertArrayHasKey('current_contract', $response->json('data'));
        $this->assertArrayHasKey('totals', $response->json('data'));
    }

    public function test_sales_report(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createFullSetup();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/reports/sales?from_date=2026-01-01&to_date=2026-12-31');

        $response->assertStatus(200);
        $this->assertArrayHasKey('summary', $response->json('data'));
        $this->assertArrayHasKey('sale', $response->json('data'));
        $this->assertArrayHasKey('rent', $response->json('data'));
        $this->assertArrayHasKey('reservations', $response->json('data'));
        $this->assertArrayHasKey('groupings', $response->json('data'));
    }

    public function test_daily_inventory(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createFullSetup();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/reports/daily-inventory?target_date=2026-06-15');

        $response->assertStatus(200);
        $this->assertArrayHasKey('summary', $response->json('data'));
        $this->assertArrayHasKey('expected', $response->json('data'));
        $this->assertArrayHasKey('payments_detail', $response->json('data'));
    }

    public function test_non_admin_cannot_access_reports(): void
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
            ->getJson('/api/v1/admin/reports/sales?from_date=2026-01-01&to_date=2026-12-31');

        $response->assertStatus(403);
    }
}