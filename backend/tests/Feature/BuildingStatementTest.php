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
 * «كشف عقار»: one building — the contracts of its units with their money rollup, the floor
 * breakdown, the reservations and the period's collections. Only active contracts count towards
 * the money figures; a cancelled one is listed as history.
 */
class BuildingStatementTest extends TestCase
{
    private User $admin;

    private string $token;

    private static int $sequence = 0;

    private Building $building;

    protected function setUp(): void
    {
        parent::setUp();

        // The overdue/due figures are computed against today.
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
        $this->building = Building::create([
            'name' => 'Building '.$n,
            'number' => 'B'.$n,
            'type' => 'building',
            'area' => 1000,
            'floors_count' => 2,
            'has_basement' => false,
        ]);
        BuildingActivity::create(['building_id' => $this->building->id, 'activity' => 'residential']);
    }

    private function headers(): array
    {
        return ['Authorization' => 'Bearer '.$this->token];
    }

    private function unit(int $floorNumber, string $name): Unit
    {
        $floor = Floor::firstOrCreate(
            ['building_id' => $this->building->id, 'floor_number' => $floorNumber],
            ['display_name' => 'الدور '.$floorNumber, 'units_count' => 0],
        );

        return Unit::create([
            'building_id' => $this->building->id,
            'floor_id' => $floor->id,
            'name' => $name,
            'type' => 'apartment',
            'activity' => 'residential',
            'purpose' => 'both',
            'area' => 100,
            'price_per_meter' => 5000,
            'is_sellable' => true,
            'status' => 'available',
        ]);
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

    private function pay(Contract $contract, int $sequenceNumber, float $amount, string $paidAt): void
    {
        $installment = $contract->installments()->where('sequence_number', $sequenceNumber)->firstOrFail();

        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => $paidAt,
            'installments' => [['installment_id' => $installment->id, 'amount' => $amount]],
        ])->assertStatus(201);
    }

    /** @return array<string, mixed> */
    private function statement(string $from = '2026-01-01', string $to = '2026-12-31'): array
    {
        return $this->withHeaders($this->headers())
            ->getJson("/api/v1/admin/reports/building-statement?building_id={$this->building->id}&from_date={$from}&to_date={$to}")
            ->assertOk()
            ->json('data');
    }

    public function test_the_statement_rolls_up_the_active_contracts_by_floor(): void
    {
        $client = $this->client();

        // Floor 1: a sale, one 20,000 row collected, one March row late, one July row not yet due.
        $sale = $this->contract([
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $this->unit(1, '101')->id,
            'contract_date' => '2026-01-01',
            'total_price' => 100000,
            'agreed_down_payment' => 20000,
            'schedule' => [
                ['due_date' => '2026-02-01', 'amount' => 20000],
                ['due_date' => '2026-03-01', 'amount' => 30000],
                ['due_date' => '2026-07-01', 'amount' => 30000],
            ],
        ]);
        $this->pay($sale, 1, 20000, '2026-02-05');

        // Floor 2: a lease, one 5,000 row collected and one February row still owed.
        $rent = $this->contract([
            'type' => 'rent',
            'client_id' => $client->id,
            'unit_id' => $this->unit(2, '201')->id,
            'contract_date' => '2026-01-01',
            'monthly_rent' => 5000,
            'duration_months' => 3,
            'start_date' => '2026-01-01',
            'end_date' => '2026-03-31',
            'schedule' => [
                ['due_date' => '2026-01-01', 'amount' => 5000],
                ['due_date' => '2026-02-01', 'amount' => 5000],
                ['due_date' => '2026-07-01', 'amount' => 5000],
            ],
        ]);
        $this->pay($rent, 1, 5000, '2026-02-10');

        $data = $this->statement();

        $this->assertSame($this->building->name, $data['building']['name']);
        $this->assertSame(2, $data['counts']['total']);
        $this->assertSame(1, $data['counts']['sold']);
        $this->assertSame(1, $data['counts']['rented']);

        // Sale: value = price, paid = schedule only (no down payment collected), remaining = both.
        $saleRow = collect($data['contracts'])->firstWhere('id', $sale->id);
        $this->assertSame(100000.0, (float) $saleRow['value']);
        $this->assertSame(20000.0, (float) $saleRow['paid']);
        $this->assertSame(80000.0, (float) $saleRow['remaining']);
        $this->assertSame(30000.0, (float) $saleRow['overdue']);
        $this->assertSame(30000.0, (float) $saleRow['due']);

        // Lease: value = the whole schedule, paid/remaining from the schedule alone.
        $rentRow = collect($data['contracts'])->firstWhere('id', $rent->id);
        $this->assertSame(15000.0, (float) $rentRow['value']);
        $this->assertSame(5000.0, (float) $rentRow['paid']);
        $this->assertSame(10000.0, (float) $rentRow['remaining']);
        $this->assertSame(5000.0, (float) $rentRow['monthly_rent']);
        $this->assertSame(5000.0, (float) $rentRow['overdue']);

        // Building totals: only active money, and «collected» is the period's real payments.
        $this->assertSame(100000.0, (float) $data['totals']['sales']);
        $this->assertSame(90000.0, (float) $data['totals']['remaining']);
        $this->assertSame(35000.0, (float) $data['totals']['overdue']);
        $this->assertSame(35000.0, (float) $data['totals']['due']);
        $this->assertSame(5000.0, (float) $data['totals']['monthly_rent']);
        $this->assertSame(25000.0, (float) $data['totals']['collected']);
        $this->assertSame(2, $data['totals']['active_contracts']);

        // Each floor carries its own contract only.
        $floors = collect($data['floors'])->keyBy('floor');
        $this->assertSame(100000.0, (float) $floors[1]['sales']);
        $this->assertSame(20000.0, (float) $floors[1]['collected']);
        $this->assertSame(0.0, (float) $floors[2]['sales']);
        $this->assertSame(5000.0, (float) $floors[2]['monthly_rent']);
        $this->assertSame(5000.0, (float) $floors[2]['collected']);

        // «المحصّل» is period money, not the contracts' lifetime payments.
        $early = $this->statement('2026-02-01', '2026-02-28');
        $this->assertSame(25000.0, (float) $early['totals']['collected']);
        $nothing = $this->statement('2026-03-01', '2026-03-31');
        $this->assertSame(0.0, (float) $nothing['totals']['collected']);
        // The period also bounds the contracts the report lists.
        $this->assertCount(0, $nothing['contracts']);
    }

    public function test_a_cancelled_contract_is_listed_but_its_money_is_not_counted(): void
    {
        $client = $this->client();
        $contract = $this->contract([
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $this->unit(1, '101')->id,
            'contract_date' => '2026-01-01',
            'total_price' => 100000,
            'agreed_down_payment' => 20000,
            'schedule' => [['due_date' => '2026-02-01', 'amount' => 80000]],
        ]);

        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/contracts/{$contract->id}/cancel", ['cancellation_reason' => 'خطأ في البيانات'])
            ->assertOk();

        $data = $this->statement();

        $row = collect($data['contracts'])->firstWhere('id', $contract->id);
        $this->assertNotNull($row);
        $this->assertFalse($row['is_active']);
        $this->assertSame('cancelled', $row['status']);

        // A cancelled schedule keeps its `remaining`; it must not reach the building figures.
        $this->assertSame(0.0, (float) $data['totals']['sales']);
        $this->assertSame(0.0, (float) $data['totals']['remaining']);
        $this->assertSame(0.0, (float) $data['totals']['overdue']);
        $this->assertSame(0.0, (float) $data['totals']['due']);
        $this->assertSame(1, $data['totals']['contracts']);
        $this->assertSame(0, $data['totals']['active_contracts']);
    }

    public function test_cancelled_payments_are_reported_but_not_collected(): void
    {
        $client = $this->client();
        $contract = $this->contract([
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $this->unit(1, '101')->id,
            'contract_date' => '2026-01-01',
            'total_price' => 30000,
            'agreed_down_payment' => 10000,
            'schedule' => [['due_date' => '2026-02-01', 'amount' => 20000]],
        ]);
        $this->pay($contract, 1, 20000, '2026-02-05');

        $receipt = Receipt::query()->firstOrFail();

        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/receipts/{$receipt->id}/cancel", ['cancel_reason' => 'شيك مرتجع'])
            ->assertOk();

        $data = $this->statement();

        $this->assertSame(0.0, (float) $data['totals']['collected']);
        $this->assertSame(20000.0, (float) $data['totals']['cancelled']);
        // The schedule went back to owing the row.
        $this->assertSame(0.0, (float) $data['contracts'][0]['paid']);
        $this->assertSame(30000.0, (float) $data['contracts'][0]['remaining']);
    }

    public function test_a_building_level_reservation_has_no_unit(): void
    {
        $client = $this->client();
        $reservation = Reservation::create([
            'client_id' => $client->id,
            'building_id' => $this->building->id,
            'unit_id' => null,
            'reservation_date' => '2026-01-10',
            'status' => 'active',
        ]);
        ReservationPayment::create([
            'reservation_id' => $reservation->id,
            'amount' => 3000,
            'paid_at' => '2026-01-10',
            'status' => 'valid',
            'created_by' => $this->admin->id,
        ]);

        $data = $this->statement();

        $this->assertCount(1, $data['reservations']);
        $row = $data['reservations'][0];
        $this->assertTrue($row['is_building_level']);
        $this->assertNull($row['unit_name']);
        $this->assertSame($client->name, $row['client_name']);
        $this->assertSame(3000.0, (float) $row['deposit_paid']);
        // That money has no floor to land on, but it is still collected by the building.
        $this->assertSame(3000.0, (float) $data['totals']['collected']);
    }
}
