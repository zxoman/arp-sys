<?php

namespace Tests\Feature;

use App\Enums\Permission;
use App\Models\Building;
use App\Models\BuildingActivity;
use App\Models\Client;
use App\Models\Contract;
use App\Models\Floor;
use App\Models\Reservation;
use App\Models\ReservationPayment;
use App\Models\Role;
use App\Models\RolePermission;
use App\Models\Unit;
use App\Models\User;
use App\Support\Clock\FrozenClock;
use Tests\TestCase;

/**
 * «كشف حساب عميل»: one client, all their contracts with the schedule rollup, every payment in
 * chronological order, and the totals the screen shows — plus the contract each payment belongs to.
 */
class CustomerStatementTest extends TestCase
{
    private User $admin;

    private string $token;

    private static int $sequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        // The overdue figures are computed against today, so the whole test runs on a frozen day.
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
    }

    private function headers(): array
    {
        return ['Authorization' => 'Bearer '.$this->token];
    }

    private function unit(): Unit
    {
        $n = ++self::$sequence;
        $building = Building::create([
            'name' => 'Building '.$n,
            'number' => 'B'.$n,
            'type' => 'building',
            'area' => 1000,
            'floors_count' => 3,
            'has_basement' => false,
        ]);
        BuildingActivity::create(['building_id' => $building->id, 'activity' => 'residential']);
        $floor = Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);

        return Unit::create([
            'building_id' => $building->id,
            'floor_id' => $floor->id,
            'name' => 'Unit '.$n,
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

    private function statement(Client $client, string $from = '2026-01-01', string $to = '2026-12-31'): array
    {
        return $this->withHeaders($this->headers())
            ->getJson("/api/v1/admin/reports/customer-statement?client_id={$client->id}&from_date={$from}&to_date={$to}")
            ->assertOk()
            ->json('data');
    }

    public function test_the_statement_rolls_up_the_schedule_payments_and_overdue(): void
    {
        $client = $this->client();
        $unit = $this->unit();

        $contractId = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $unit->id,
            'contract_date' => '2026-01-01',
            'total_price' => 100000,
            'agreed_down_payment' => 20000,
            'schedule' => [
                ['due_date' => '2026-02-01', 'amount' => 20000],
                ['due_date' => '2026-03-01', 'amount' => 20000],
                ['due_date' => '2026-07-01', 'amount' => 20000],
            ],
        ])->assertStatus(201)->json('data.id');

        $contract = Contract::findOrFail($contractId);
        $installments = $contract->installments()->orderBy('sequence_number')->get();

        // One receipt: the first installment in full plus part of the down payment.
        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'payment_method' => 'cash',
            'installments' => [['installment_id' => $installments[0]->id, 'amount' => 20000]],
            'down_payment' => 5000,
        ])->assertStatus(201);

        $data = $this->statement($client);

        $this->assertSame($client->name, $data['client']['name']);
        $this->assertCount(1, $data['contracts']);

        $row = $data['contracts'][0];
        $this->assertSame($contract->number, $row['number']);
        $this->assertSame('sale', $row['type']);
        $this->assertSame(100000.0, (float) $row['total_price']);
        $this->assertSame(20000.0, (float) $row['agreed_down_payment']);
        $this->assertSame(5000.0, (float) $row['down_payment_paid']);
        $this->assertSame(15000.0, (float) $row['down_payment_remaining']);
        $this->assertSame(60000.0, (float) $row['installment_totals']['required']);
        $this->assertSame(20000.0, (float) $row['installment_totals']['paid']);
        $this->assertSame(40000.0, (float) $row['installment_totals']['remaining']);
        // Only the March row is past its due date on 2026-06-01; the July one is not late yet.
        $this->assertSame(20000.0, (float) $row['installment_totals']['overdue']);
        $this->assertTrue($row['installments'][1]['is_overdue']);
        $this->assertFalse($row['installments'][2]['is_overdue']);

        // The «متأخرات» card reads the overdue installments, not the whole contract remainder.
        $this->assertSame(20000.0, (float) $data['totals']['overdue']);
        // The remaining is the contract value minus what was collected (25,000: 20,000 + 5,000).
        $this->assertSame(75000.0, (float) $data['totals']['remaining']);
        $this->assertSame(25000.0, (float) $data['totals']['paid']);

        // Two payment lines (installment + down payment), both valid and in chronological order.
        $this->assertCount(2, $data['payments']);
        $this->assertSame('2026-02-05', substr((string) $data['payments'][0]['paid_at'], 0, 10));
        $this->assertSame($contract->number, $data['payments'][0]['contract_number']);
        $this->assertSame($contract->id, $data['payments'][0]['contract_id']);
    }

    public function test_a_reservation_payment_belongs_to_no_contract_yet(): void
    {
        $client = $this->client();
        $unit = $this->unit();

        $reservation = Reservation::create([
            'client_id' => $client->id,
            'building_id' => $unit->building_id,
            'unit_id' => $unit->id,
            'unit_type' => 'apartment',
            'unit_activity' => 'residential',
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

        $data = $this->statement($client);

        $this->assertCount(0, $data['contracts']);
        $this->assertSame(1, $data['reservation_totals']['paid'] !== null ? 1 : 0);
        $this->assertSame(3000.0, (float) $data['reservation_totals']['paid']);
        $this->assertSame(3000.0, (float) $data['totals']['paid']);

        $payment = $data['payments'][0];
        $this->assertSame('reservation', $payment['payment_type']);
        $this->assertNull($payment['contract_id']);
        $this->assertNull($payment['contract_number']);
    }

    public function test_the_period_filters_contracts_and_payments(): void
    {
        $client = $this->client();
        $contractId = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $this->unit()->id,
            'contract_date' => '2026-01-01',
            'total_price' => 40000,
            'agreed_down_payment' => 10000,
            'schedule' => [['due_date' => '2026-02-01', 'amount' => 30000]],
        ])->assertStatus(201)->json('data.id');

        $contract = Contract::findOrFail($contractId);
        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'installments' => [['installment_id' => $contract->installments()->first()->id, 'amount' => 30000]],
        ])->assertStatus(201);

        // A period after the contract and its payment: nothing on the statement.
        $later = $this->statement($client, '2026-03-01', '2026-12-31');
        $this->assertCount(0, $later['contracts']);
        $this->assertCount(0, $later['payments']);

        // The period covering both: the contract and its one payment.
        $period = $this->statement($client, '2026-01-01', '2026-02-28');
        $this->assertCount(1, $period['contracts']);
        $this->assertCount(1, $period['payments']);
    }
}
