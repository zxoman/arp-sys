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
 * «الإيرادات الشهرية»: the money actually collected per month (deposits, down payments, schedule),
 * with cancelled lines reported apart and the period/building narrowing the rows.
 */
class MonthlyRevenueTest extends TestCase
{
    private User $admin;

    private string $token;

    private static int $sequence = 0;

    private Building $building;

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

        $this->building = $this->makeBuilding();
        $this->unit = $this->makeUnit($this->building);
    }

    private function makeBuilding(): Building
    {
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

        return $building;
    }

    private function makeUnit(Building $building, string $name = '101'): Unit
    {
        $floor = Floor::firstOrCreate(
            ['building_id' => $building->id, 'floor_number' => 1],
            ['display_name' => 'الأول', 'units_count' => 0],
        );

        return Unit::create([
            'building_id' => $building->id,
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

    private function headers(): array
    {
        return ['Authorization' => 'Bearer '.$this->token];
    }

    private function receipt(Contract $contract, string $paidAt, array $lines, ?float $downPayment = null): void
    {
        $payload = [
            'contract_id' => $contract->id,
            'paid_at' => $paidAt,
            'installments' => $lines,
        ];
        if ($downPayment !== null) {
            $payload['down_payment'] = $downPayment;
        }

        $this->withHeaders($this->headers())
            ->postJson('/api/v1/admin/receipts', $payload)
            ->assertStatus(201);
    }

    /** @return array<string, mixed> */
    private function report(string $from = '2026-01-01', string $to = '2026-12-31', ?int $buildingId = null): array
    {
        $query = http_build_query(array_filter([
            'from_date' => $from,
            'to_date' => $to,
            'building_id' => $buildingId,
        ]));

        return $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/monthly-revenue?'.$query)
            ->assertOk()
            ->json('data');
    }

    public function test_the_months_roll_up_the_collected_money(): void
    {
        $contract = $this->contract([
            'type' => 'sale',
            'client_id' => $this->client()->id,
            'unit_id' => $this->unit->id,
            'contract_date' => '2026-01-01',
            'total_price' => 100000,
            'agreed_down_payment' => 20000,
            'schedule' => [
                ['due_date' => '2026-02-01', 'amount' => 40000],
                ['due_date' => '2026-03-01', 'amount' => 40000],
            ],
        ]);

        $rows = $contract->installments()->orderBy('sequence_number')->get();

        // January: part of the down payment plus the first installment, on one receipt.
        $this->receipt($contract, '2026-01-05', [['installment_id' => $rows[0]->id, 'amount' => 10000]], 5000);
        // February: the second installment, on its own receipt.
        $this->receipt($contract, '2026-02-05', [['installment_id' => $rows[1]->id, 'amount' => 40000]]);

        // A reservation deposit is real cash too, and it has no contract.
        $reservation = Reservation::create([
            'client_id' => $this->client()->id,
            'building_id' => $this->building->id,
            'unit_id' => $this->makeUnit($this->building, '102')->id,
            'reservation_date' => '2026-02-10',
            'status' => 'active',
        ]);
        ReservationPayment::create([
            'reservation_id' => $reservation->id,
            'amount' => 3000,
            'paid_at' => '2026-02-10',
            'status' => 'valid',
            'created_by' => $this->admin->id,
        ]);

        $data = $this->report();

        $this->assertSame('2026-01-01', $data['period']['from']);
        $this->assertCount(2, $data['months']);

        $january = $data['months'][0];
        $this->assertSame('2026-01', $january['month']);
        $this->assertSame(2, $january['payments']);
        $this->assertSame(1, $january['receipts']);
        $this->assertSame(5000.0, (float) $january['down_payments']);
        $this->assertSame(10000.0, (float) $january['installments']);
        $this->assertSame(0.0, (float) $january['reservations']);
        $this->assertSame(15000.0, (float) $january['total']);
        $this->assertSame(15000.0, (float) $january['cumulative']);

        $february = $data['months'][1];
        $this->assertSame('2026-02', $february['month']);
        $this->assertSame(2, $february['payments']);
        // The reservation deposit has no receipt; only the contract receipt counts.
        $this->assertSame(1, $february['receipts']);
        $this->assertSame(3000.0, (float) $february['reservations']);
        $this->assertSame(40000.0, (float) $february['installments']);
        $this->assertSame(43000.0, (float) $february['total']);
        $this->assertSame(58000.0, (float) $february['cumulative']);

        $this->assertSame(4, $data['totals']['payments']);
        $this->assertSame(2, $data['totals']['receipts']);
        $this->assertSame(5000.0, (float) $data['totals']['down_payments']);
        $this->assertSame(50000.0, (float) $data['totals']['installments']);
        $this->assertSame(3000.0, (float) $data['totals']['reservations']);
        $this->assertSame(58000.0, (float) $data['totals']['total']);
    }

    public function test_a_cancelled_receipt_is_reported_but_not_collected(): void
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
        $installment = $contract->installments()->firstOrFail();

        $this->receipt($contract, '2026-01-10', [['installment_id' => $installment->id, 'amount' => 20000]]);

        $receipt = Receipt::query()->firstOrFail();
        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/receipts/{$receipt->id}/cancel", ['cancel_reason' => 'شيك مرتجع'])
            ->assertOk();

        $data = $this->report();
        $january = $data['months'][0];

        $this->assertSame(0.0, (float) $january['total']);
        $this->assertSame(20000.0, (float) $january['cancelled']);
        $this->assertSame(0, $data['totals']['payments']);
        $this->assertSame(20000.0, (float) $data['totals']['cancelled']);
    }

    public function test_the_building_filter_narrows_the_money(): void
    {
        $other = $this->makeBuilding();
        $otherUnit = $this->makeUnit($other, '201');

        foreach ([$this->unit, $otherUnit] as $unit) {
            $contract = $this->contract([
                'type' => 'sale',
                'client_id' => $this->client()->id,
                'unit_id' => $unit->id,
                'contract_date' => '2026-01-01',
                'total_price' => 30000,
                'agreed_down_payment' => 10000,
                'schedule' => [['due_date' => '2026-02-01', 'amount' => 20000]],
            ]);
            $this->receipt($contract, '2026-01-10', [], 10000);
        }

        $this->assertSame(20000.0, (float) $this->report()['totals']['total']);
        $this->assertSame(10000.0, (float) $this->report(buildingId: $this->building->id)['totals']['total']);
        $this->assertSame(10000.0, (float) $this->report(buildingId: $other->id)['totals']['total']);
    }

    public function test_the_period_bounds_the_months(): void
    {
        $contract = $this->contract([
            'type' => 'sale',
            'client_id' => $this->client()->id,
            'unit_id' => $this->unit->id,
            'contract_date' => '2026-01-01',
            'total_price' => 60000,
            'agreed_down_payment' => 0,
            'schedule' => [
                ['due_date' => '2026-01-15', 'amount' => 20000],
                ['due_date' => '2026-03-15', 'amount' => 20000],
                ['due_date' => '2026-05-15', 'amount' => 20000],
            ],
        ]);
        $rows = $contract->installments()->orderBy('sequence_number')->get();

        $this->receipt($contract, '2026-01-15', [['installment_id' => $rows[0]->id, 'amount' => 20000]]);
        $this->receipt($contract, '2026-03-15', [['installment_id' => $rows[1]->id, 'amount' => 20000]]);

        $february = $this->report('2026-02-01', '2026-02-28');
        $this->assertSame([], $february['months']);
        $this->assertSame(0.0, (float) $february['totals']['total']);

        $spring = $this->report('2026-01-01', '2026-03-31');
        $this->assertCount(2, $spring['months']);
        $this->assertSame(['2026-01', '2026-03'], array_column($spring['months'], 'month'));
        $this->assertSame(40000.0, (float) $spring['months'][1]['cumulative']);

        // The cumulative starts again at the period, like the rows.
        $march = $this->report('2026-03-01', '2026-03-31');
        $this->assertSame(20000.0, (float) $march['months'][0]['cumulative']);
    }
}
