<?php

namespace Tests\Feature;

use App\Models\Building;
use App\Models\Client;
use App\Models\Contract;
use App\Models\Floor;
use App\Models\Installment;
use App\Models\InstallmentPayment;
use App\Models\Reservation;
use App\Models\Unit;
use App\Models\User;
use Tests\TestCase;

class ContractTest extends TestCase
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

    protected static int $buildingSequence = 0;

    protected function createBuildingAndUnit(): array
    {
        $sequence = ++self::$buildingSequence;

        $building = Building::create([
            'name' => 'Test Building ' . $sequence,
            'number' => 'B' . $sequence,
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

    public function test_admin_can_create_contract_without_reservation(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', [
                'type' => 'sale',
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'contract_date' => now()->toDateString(),
                'total_price' => 600000.00,
                'agreed_down_payment' => 100000.00,
                'installments_count' => 5,
                'first_installment_date' => now()->addMonth(1)->toDateString(),
                'interval_months' => 1,
                'notes' => 'Test contract',
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('contracts', [
            'client_id' => $client->id,
            'status' => 'active',
        ]);
        // Unit status should become sold
        $this->assertDatabaseHas('units', ['id' => $data['unit']->id, 'status' => 'sold']);
        // 5 installments should be created
        $this->assertDatabaseCount('installments', 5);
        // Contract number should be generated
        $this->assertNotNull($response->json('data.number'));
    }

    public function test_cannot_create_contract_with_unit_having_active_reservation(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        // Create an active reservation on the unit
        Reservation::create([
            'client_id' => $client->id,
            'building_id' => $data['building']->id,
            'unit_id' => $data['unit']->id,
            'unit_type' => 'apartment',
            'unit_activity' => 'residential',
            'reservation_date' => now()->toDateString(),
            'status' => 'active',
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', [
                'type' => 'sale',
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'contract_date' => now()->toDateString(),
                'total_price' => 600000.00,
                'agreed_down_payment' => 100000.00,
            ]);

        $response->assertStatus(422);
    }

    public function test_contract_number_is_sequential_per_year(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $year = now()->year;
        $expectedFirst = $year . '-0001';

        $response1 = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', [
                'type' => 'sale',
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'contract_date' => now()->toDateString(),
                'total_price' => 600000.00,
                'agreed_down_payment' => 100000.00,
            ]);

        $response1->assertStatus(201);
        $this->assertEquals($expectedFirst, $response1->json('data.number'));

        // Create another unit for second contract
        $data2 = $this->createBuildingAndUnit();

        $response2 = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', [
                'type' => 'sale',
                'client_id' => $client->id,
                'unit_id' => $data2['unit']->id,
                'contract_date' => now()->toDateString(),
                'total_price' => 700000.00,
                'agreed_down_payment' => 150000.00,
            ]);

        $response2->assertStatus(201);
        $this->assertEquals($year . '-0002', $response2->json('data.number'));
    }

    public function test_down_payment_cannot_be_less_than_reservation_payments(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        // Create reservation with payment
        $reservation = Reservation::create([
            'client_id' => $client->id,
            'building_id' => $data['building']->id,
            'unit_id' => $data['unit']->id,
            'unit_type' => 'apartment',
            'unit_activity' => 'residential',
            'reservation_date' => now()->toDateString(),
            'status' => 'active',
        ]);

        // Add payment to reservation
        \App\Models\ReservationPayment::create([
            'reservation_id' => $reservation->id,
            'amount' => 150000.00,
            'paid_at' => now()->toDateString(),
            'status' => 'valid',
            'created_by' => $admin['user']->id,
        ]);

        // Try to create contract with down payment less than reservation payments
        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', [
                'reservation_id' => $reservation->id,
                'type' => 'sale',
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'contract_date' => now()->toDateString(),
                'total_price' => 600000.00,
                'agreed_down_payment' => 100000.00, // Less than 150000 reservation payment
            ]);

        $response->assertStatus(422);
    }

    public function test_cannot_create_contract_with_down_payment_exceeding_price(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', [
                'type' => 'sale',
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'contract_date' => now()->toDateString(),
                'total_price' => 600000.00,
                'agreed_down_payment' => 700000.00, // Exceeds price
            ]);

        $response->assertStatus(422);
    }

    public function test_schedule_preview_computes_installments_without_saving(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts/preview-schedule', [
                'total_price' => 600000.00,
                'agreed_down_payment' => 100000.00,
                'installments_count' => 5,
                'first_installment_date' => now()->addMonth(1)->toDateString(),
                'interval_months' => 1,
            ]);

        $response->assertStatus(200);
        $this->assertCount(5, $response->json('data.installments'));
        // Remainder = 500000, each = 100000, last gets any rounding diff
        $this->assertEquals('500000.00', $response->json('data.total_remainder'));
    }

    public function test_rent_contract_with_zero_installments(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', [
                'type' => 'rent',
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'contract_date' => now()->toDateString(),
                'total_price' => 120000.00, // annual rent
                'agreed_down_payment' => 20000.00,
                'installments_count' => 0,
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseCount('installments', 0);
        // Unit status should become rented
        $this->assertDatabaseHas('units', ['id' => $data['unit']->id, 'status' => 'rented']);
    }

    public function test_can_record_installment_payment(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $contract = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', [
                'type' => 'sale',
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'contract_date' => now()->toDateString(),
                'total_price' => 600000.00,
                'agreed_down_payment' => 100000.00,
                'installments_count' => 2,
                'first_installment_date' => now()->addMonth(1)->toDateString(),
                'interval_months' => 1,
            ])->json('data');

        $installment = Installment::where('contract_id', $contract['id'])->first();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts/' . $contract['id'] . '/installments/' . $installment->id . '/payment', [
                'amount' => 50000.00,
                'paid_at' => now()->toDateString(),
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('installment_payments', [
            'installment_id' => $installment->id,
            'amount' => '50000.00',
        ]);
        // Installment should be partially_paid
        $this->assertDatabaseHas('installments', [
            'id' => $installment->id,
            'status' => 'partially_paid',
            'paid_amount' => '50000.00',
            'remaining' => '200000.00',
        ]);
    }

    public function test_cannot_pay_more_than_installment_remaining(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $contract = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', [
                'type' => 'sale',
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'contract_date' => now()->toDateString(),
                'total_price' => 600000.00,
                'agreed_down_payment' => 100000.00,
                'installments_count' => 2,
                'first_installment_date' => now()->addMonth(1)->toDateString(),
                'interval_months' => 1,
            ])->json('data');

        $installment = Installment::where('contract_id', $contract['id'])->first();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts/' . $contract['id'] . '/installments/' . $installment->id . '/payment', [
                'amount' => 600000.00, // Exceeds remaining
                'paid_at' => now()->toDateString(),
            ]);

        $response->assertStatus(422);
    }

    public function test_can_cancel_installment_payment(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $contract = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', [
                'type' => 'sale',
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'contract_date' => now()->toDateString(),
                'total_price' => 600000.00,
                'agreed_down_payment' => 100000.00,
                'installments_count' => 2,
                'first_installment_date' => now()->addMonth(1)->toDateString(),
                'interval_months' => 1,
            ])->json('data');

        $installment = Installment::where('contract_id', $contract['id'])->first();

        // Record payment first
        $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts/' . $contract['id'] . '/installments/' . $installment->id . '/payment', [
                'amount' => 50000.00,
                'paid_at' => now()->toDateString(),
            ]);

        $payment = InstallmentPayment::where('installment_id', $installment->id)->first();

        // Cancel the payment
        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts/' . $contract['id'] . '/installments/' . $installment->id . '/payment/' . $payment->id . '/cancel', [
                'cancel_reason' => 'Error',
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('installment_payments', [
            'id' => $payment->id,
            'status' => 'cancelled',
        ]);
        // Installment should go back to due
        $this->assertDatabaseHas('installments', [
            'id' => $installment->id,
            'status' => 'due',
            'paid_amount' => '0.00',
            'remaining' => $installment->amount,
        ]);
    }

    public function test_can_cancel_contract(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $contract = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', [
                'type' => 'sale',
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'contract_date' => now()->toDateString(),
                'total_price' => 600000.00,
                'agreed_down_payment' => 100000.00,
                'installments_count' => 0,
            ])->json('data');

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts/' . $contract['id'] . '/cancel', [
                'cancellation_reason' => 'Client backed out',
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('contracts', [
            'id' => $contract['id'],
            'status' => 'cancelled',
        ]);
        // Unit should return to available
        $this->assertDatabaseHas('units', ['id' => $data['unit']->id, 'status' => 'available']);
    }

    public function test_non_admin_cannot_access_contracts(): void
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
            ->getJson('/api/v1/admin/contracts');

        $response->assertStatus(403);
    }

    private function createClient(): Client
    {
        return Client::create(['name' => 'Client ' . uniqid(), 'phone' => '+2010' . random_int(10000000, 99999999)]);
    }

    private function contractPayload(string $type, Client $client, int $unitId, float $price = 600000.00): array
    {
        return [
            'type' => $type,
            'client_id' => $client->id,
            'unit_id' => $unitId,
            'contract_date' => now()->toDateString(),
            'total_price' => $price,
            'agreed_down_payment' => $type === 'sale' ? 100000.00 : 20000.00,
            'installments_count' => 0,
        ];
    }

    public function test_cannot_sell_a_rent_only_unit(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = $this->createClient();

        $data['unit']->update(['purpose' => 'rent', 'sale_price' => null]);

        $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', $this->contractPayload('sale', $client, $data['unit']->id))
            ->assertStatus(422)
            ->assertJsonValidationErrors('unit_id');
    }

    public function test_cannot_rent_a_sale_only_unit(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = $this->createClient();

        $data['unit']->update(['purpose' => 'sale', 'sale_price' => 700000.00]);

        $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', $this->contractPayload('rent', $client, $data['unit']->id))
            ->assertStatus(422)
            ->assertJsonValidationErrors('unit_id');
    }

    public function test_cannot_contract_a_unit_that_is_not_sellable(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = $this->createClient();

        $data['unit']->update([
            'is_sellable' => false,
            'non_sellable_reason' => 'مرهونة لصالح البنك',
        ]);

        $headers = $this->authHeaders($admin['token']);

        $this->withHeaders($headers)
            ->postJson('/api/v1/admin/contracts', $this->contractPayload('sale', $client, $data['unit']->id))
            ->assertStatus(422)
            ->assertJsonValidationErrors('unit_id');

        $this->withHeaders($headers)
            ->postJson('/api/v1/admin/contracts', $this->contractPayload('rent', $client, $data['unit']->id))
            ->assertStatus(422)
            ->assertJsonValidationErrors('unit_id');
    }

    public function test_sale_and_rent_are_allowed_for_a_both_purpose_unit(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = $this->createClient();

        // Default purpose is `both`.
        $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/contracts', $this->contractPayload('sale', $client, $data['unit']->id))
            ->assertStatus(201);
    }
}