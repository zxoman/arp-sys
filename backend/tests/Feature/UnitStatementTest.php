<?php

namespace Tests\Feature;

use App\Enums\Permission;
use App\Models\Building;
use App\Models\BuildingActivity;
use App\Models\Client;
use App\Models\Contract;
use App\Models\Floor;
use App\Models\Receipt;
use App\Models\Reservation;
use App\Models\ReservationPayment;
use App\Models\Role;
use App\Models\RolePermission;
use App\Models\Unit;
use App\Models\User;
use App\Support\Clock\FrozenClock;
use Tests\TestCase;

/**
 * «كشف وحدة»: one unit — its history of reservations and contracts, the schedule of the current
 * contract with the day each row was collected, and the money rollup of the active contract.
 */
class UnitStatementTest extends TestCase
{
    private User $admin;

    private string $token;

    private static int $sequence = 0;

    private Unit $unit;

    protected function setUp(): void
    {
        parent::setUp();

        FrozenClock::parse('2026-06-01 10:00:00');

        $role = Role::create(['name' => 'admin', 'is_admin' => true]);
        foreach (Permission::all() as $permission) {
            RolePermission::firstOrCreate(['role_id' => $role->id, 'permission' => $permission]);
        }

        $this->admin = User::create([
            'name' => 'Admin',
            'username' => 'admin',
            'password' => bcrypt('password123'),
            'role_id' => $role->id,
            'status' => 'active',
            'lock_version' => 0,
        ]);

        $this->token = $this->postJson('/api/v1/auth/login', [
            'login' => 'admin',
            'password' => 'password123',
        ])->json('data.token');

        $n = ++self::$sequence;
        $building = Building::create([
            'name' => 'Building '.$n,
            'number' => 'B'.$n,
            'type' => 'building',
            'area' => 1000,
            'floors_count' => 1,
            'has_basement' => false,
        ]);
        BuildingActivity::create(['building_id' => $building->id, 'activity' => 'residential']);
        $floor = Floor::create([
            'building_id' => $building->id,
            'floor_number' => 2,
            'display_name' => 'الثاني',
            'units_count' => 0,
        ]);

        $this->unit = Unit::create([
            'building_id' => $building->id,
            'floor_id' => $floor->id,
            'name' => 'Unit '.$n,
            'type' => 'apartment',
            'activity' => 'residential',
            'purpose' => 'both',
            'area' => 100,
            'price_per_meter' => 5000,
            'rooms' => 3,
            'bathrooms' => 2,
            'is_sellable' => true,
            'status' => 'available',
        ]);
    }

    private function headers(): array
    {
        return ['Authorization' => 'Bearer '.$this->token];
    }

    private function client(): Client
    {
        return Client::create([
            'name' => 'Client '.++self::$sequence,
            'phone' => '+201000000'.random_int(100, 999),
        ]);
    }

    /** @param  array<string, mixed>  $payload */
    private function contract(array $payload): Contract
    {
        $id = $this->withHeaders($this->headers())
            ->postJson('/api/v1/admin/contracts', $payload)
            ->assertStatus(201)
            ->json('data.id');

        return Contract::findOrFail($id);
    }

    /** @return array<string, mixed> */
    private function statement(): array
    {
        return $this->withHeaders($this->headers())
            ->getJson("/api/v1/admin/reports/unit-statement?unit_id={$this->unit->id}&from_date=1900-01-01&to_date=2100-12-31")
            ->assertOk()
            ->json('data');
    }

    public function test_the_statement_returns_the_current_contract_and_its_schedule(): void
    {
        $client = $this->client();
        $contract = $this->contract([
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $this->unit->id,
            'contract_date' => '2026-01-01',
            'total_price' => 100000,
            'agreed_down_payment' => 20000,
            'schedule' => [
                ['due_date' => '2026-02-01', 'amount' => 20000],
                ['due_date' => '2026-03-01', 'amount' => 30000],
                ['due_date' => '2026-07-01', 'amount' => 30000],
            ],
        ]);

        // One receipt: the first row in full, plus part of the down payment.
        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'installments' => [['installment_id' => $contract->installments()->orderBy('sequence_number')->first()->id, 'amount' => 20000]],
            'down_payment' => 5000,
        ])->assertStatus(201);

        $data = $this->statement();

        $this->assertSame($this->unit->name, $data['unit']['name']);
        $this->assertSame('الثاني', $data['unit']['floor_display_name']);
        $this->assertSame(2, $data['unit']['floor']);
        $this->assertSame(3, $data['unit']['rooms']);
        $this->assertSame(2, $data['unit']['bathrooms']);
        $this->assertSame(500000.0, (float) $data['unit']['total_price']);
        // A lease-only unit has no sale price; this one is «both».
        $this->assertSame('both', $data['unit']['purpose']);

        $this->assertNotNull($data['current_contract']);
        $this->assertSame($contract->id, $data['current_contract']['id']);
        $this->assertSame($client->name, $data['client']['name']);

        // Sale money: price / down payment + schedule paid / both balances left.
        $this->assertSame(100000.0, (float) $data['current_contract']['value']);
        $this->assertSame(25000.0, (float) $data['current_contract']['paid']);
        $this->assertSame(75000.0, (float) $data['current_contract']['remaining']);
        $this->assertSame(30000.0, (float) $data['current_contract']['overdue']);

        $rows = collect($data['current_contract']['installments'])->keyBy('sequence_number');
        $this->assertSame(20000.0, (float) $rows[1]['paid_amount']);
        // The day the row was collected, not the day it was due.
        $this->assertSame('2026-02-05', $rows[1]['paid_at']);
        $this->assertFalse($rows[1]['is_overdue']);
        // Only the March row is past its date on 2026-06-01.
        $this->assertTrue($rows[2]['is_overdue']);
        $this->assertFalse($rows[3]['is_overdue']);
        $this->assertNull($rows[2]['paid_at']);

        $this->assertSame(100000.0, (float) $data['totals']['sales']);
        $this->assertSame(75000.0, (float) $data['totals']['remaining']);
        $this->assertSame(30000.0, (float) $data['totals']['overdue']);

        // A second read shows the whole contract history, not just the current row.
        $this->assertCount(1, $data['contracts']);
    }

    public function test_a_cancelled_contract_stays_in_the_history_without_money(): void
    {
        $contract = $this->contract([
            'type' => 'sale',
            'client_id' => $this->client()->id,
            'unit_id' => $this->unit->id,
            'contract_date' => '2026-01-01',
            'total_price' => 50000,
            'agreed_down_payment' => 10000,
            'schedule' => [['due_date' => '2026-02-01', 'amount' => 40000]],
        ]);

        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/contracts/{$contract->id}/cancel", ['cancellation_reason' => 'خطأ في البيانات'])
            ->assertOk();

        $data = $this->statement();

        $this->assertNull($data['current_contract']);
        $this->assertCount(1, $data['contracts']);

        $row = $data['contracts'][0];
        $this->assertTrue($row['is_cancelled']);
        $this->assertFalse($row['is_active']);
        // Cancelled rows keep their amounts but never count.
        $this->assertTrue($row['installments'][0]['is_cancelled']);
        $this->assertFalse($row['installments'][0]['is_overdue']);

        $this->assertSame(0.0, (float) $data['totals']['sales']);
        $this->assertSame(0.0, (float) $data['totals']['remaining']);
        $this->assertSame(0.0, (float) $data['totals']['overdue']);
        $this->assertSame(0.0, (float) $data['totals']['paid']);
        // The unit went back to the market.
        $this->assertSame('available', $data['unit']['status']);
    }

    public function test_the_current_reservation_and_its_deposit_are_shown(): void
    {
        $client = $this->client();
        // Creating the reservation through the API is what puts the unit in «محجوزة».
        $reservationId = $this->withHeaders($this->headers())->postJson('/api/v1/admin/reservations', [
            'client_id' => $client->id,
            'unit_id' => $this->unit->id,
            'reservation_date' => '2026-01-10',
        ])->assertStatus(201)->json('data.id');

        ReservationPayment::create([
            'reservation_id' => $reservationId,
            'amount' => 3000,
            'paid_at' => '2026-01-10',
            'status' => 'valid',
            'created_by' => $this->admin->id,
        ]);

        $data = $this->statement();

        $this->assertNull($data['current_contract']);
        $this->assertNotNull($data['current_reservation']);
        $this->assertSame($reservationId, $data['current_reservation']['id']);
        $this->assertSame(3000.0, (float) $data['current_reservation']['deposit_paid']);
        $this->assertSame($client->name, $data['client']['name']);
        $this->assertSame($client->phone, $data['client']['phone']);
        $this->assertSame(3000.0, (float) $data['totals']['deposit_paid']);
        $this->assertSame('reserved', $data['unit']['status']);
        $this->assertCount(1, $data['reservations']);
    }

    public function test_a_cancelled_receipt_is_not_a_paid_day(): void
    {
        $contract = $this->contract([
            'type' => 'sale',
            'client_id' => $this->client()->id,
            'unit_id' => $this->unit->id,
            'contract_date' => '2026-01-01',
            'total_price' => 30000,
            'agreed_down_payment' => 10000,
            'schedule' => [['due_date' => '2026-02-01', 'amount' => 20000]],
        ]);

        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'installments' => [['installment_id' => $contract->installments()->first()->id, 'amount' => 20000]],
        ])->assertStatus(201);

        $receipt = Receipt::query()->firstOrFail();
        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/receipts/{$receipt->id}/cancel", ['cancel_reason' => 'شيك مرتجع'])
            ->assertOk();

        $data = $this->statement();
        $row = $data['current_contract']['installments'][0];

        $this->assertNull($row['paid_at']);
        $this->assertSame(0.0, (float) $row['paid_amount']);
        $this->assertSame(0.0, (float) $data['totals']['paid']);
        $this->assertSame(30000.0, (float) $data['totals']['remaining']);
    }
}
