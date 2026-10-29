<?php

namespace Tests\Feature;

use App\Models\Building;
use App\Models\BuildingActivity;
use App\Models\Client;
use App\Models\Contract;
use App\Models\Floor;
use App\Models\Role;
use App\Models\RolePermission;
use App\Models\Unit;
use App\Models\User;
use Tests\TestCase;

/**
 * «ملخص الأقساط والعقود»: one row per non-draft contract with its schedule rollup (money totals,
 * how many rows are collected, the last collected row and the row still owed), server-filtered by
 * contract type, building, client and status.
 */
class InstallmentsSummaryTest extends TestCase
{
    private User $admin;

    private string $token;

    private static int $sequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $role = Role::create(['name' => 'admin', 'is_admin' => true]);
        foreach (\App\Enums\Permission::all() as $permission) {
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
        return ['Authorization' => 'Bearer ' . $this->token];
    }

    private function unit(?Building $building = null): Unit
    {
        $n = ++self::$sequence;

        $building ??= Building::create([
            'name' => 'Building ' . $n,
            'number' => 'B' . $n,
            'type' => 'building',
            'area' => 1000,
            'floors_count' => 3,
            'has_basement' => false,
        ]);
        if (! $building->activities()->exists()) {
            BuildingActivity::create(['building_id' => $building->id, 'activity' => 'residential']);
        }
        $floor = Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);

        return Unit::create([
            'building_id' => $building->id,
            'floor_id' => $floor->id,
            'name' => 'Unit ' . $n,
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
            'name' => 'Client ' . ++self::$sequence,
            'phone' => '+201000000' . random_int(100, 999),
        ]);
    }

    /** @param  array<int, array{due_date: string, amount: int}>  $schedule */
    private function saleContract(array $schedule, float $downPayment = 30000, ?Unit $unit = null, ?Client $client = null): Contract
    {
        $id = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'client_id' => ($client ?? $this->client())->id,
            'unit_id' => ($unit ?? $this->unit())->id,
            'contract_date' => '2026-02-01',
            'total_price' => array_sum(array_column($schedule, 'amount')) + $downPayment,
            'agreed_down_payment' => $downPayment,
            'schedule' => $schedule,
        ])->assertStatus(201)->json('data.id');

        return Contract::findOrFail($id);
    }

    private function rentContract(?Unit $unit = null, ?Client $client = null, float $deposit = 10000): Contract
    {
        $id = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'rent',
            'client_id' => ($client ?? $this->client())->id,
            'unit_id' => ($unit ?? $this->unit())->id,
            'contract_date' => '2026-02-01',
            'agreed_down_payment' => 0,
            'monthly_rent' => 5000,
            'duration_months' => 6,
            'start_date' => '2026-02-01',
            'security_deposit' => $deposit,
        ])->assertStatus(201)->json('data.id');

        return Contract::findOrFail($id);
    }

    /** Pay installments (1-based sequence => amount) and optionally part of the down payment. */
    private function pay(Contract $contract, array $installmentAmounts, ?float $downPayment = null): void
    {
        $installments = $contract->installments()->orderBy('sequence_number')->get();
        $payload = ['contract_id' => $contract->id, 'paid_at' => '2026-03-01', 'installments' => []];
        foreach ($installmentAmounts as $sequence => $amount) {
            $payload['installments'][] = ['installment_id' => $installments[$sequence - 1]->id, 'amount' => $amount];
        }
        if ($downPayment !== null) {
            $payload['down_payment'] = $downPayment;
        }

        $this->withHeaders($this->headers())
            ->postJson('/api/v1/admin/receipts', $payload)
            ->assertStatus(201);
    }

    public function test_a_sale_row_carries_the_schedule_rollup(): void
    {
        $contract = $this->saleContract([
            ['due_date' => '2026-03-01', 'amount' => 15000],
            ['due_date' => '2026-04-01', 'amount' => 15000],
            ['due_date' => '2026-05-01', 'amount' => 15000],
            ['due_date' => '2026-06-01', 'amount' => 15000],
        ]);
        // Row 2 is partially collected, row 4 is full, and 5,000 of the down payment is in.
        $this->pay($contract, [2 => 5000, 4 => 15000], 5000);

        $response = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/installments-summary?type=sale');

        $response->assertOk()->assertJsonCount(1, 'data');
        $row = $response->json('data.0');

        $this->assertSame('2026-0001', $row['number']);
        $this->assertSame('sale', $row['type']);
        $this->assertSame('active', $row['status']);
        $this->assertSame(90000.0, (float) $row['unit_price']);
        $this->assertSame(30000.0, (float) $row['down_payment']);
        $this->assertSame(25000.0, (float) $row['down_payment_remaining']);
        $this->assertSame(60000.0, (float) $row['installments_total']);
        $this->assertSame(20000.0, (float) $row['installments_paid']);
        $this->assertSame(40000.0, (float) $row['installments_remaining']);
        $this->assertSame(4, $row['total_installments']);
        $this->assertSame(1, $row['paid_installments']);
        // First row still owed and last row fully collected.
        $this->assertSame(1, $row['next_due_installment']['sequence_number']);
        $this->assertSame('2026-03-01', $row['next_due_installment']['due_date']);
        $this->assertSame(15000.0, (float) $row['current_installment_remaining']);
        $this->assertSame(4, $row['last_paid_installment']['sequence_number']);
        // Down payment + schedule, minus what was collected.
        $this->assertSame(90000.0, (float) $row['contract_value']);
        $this->assertSame(25000.0, (float) $row['total_paid']);
        $this->assertSame(65000.0, (float) $row['total_remaining']);
    }

    public function test_a_lease_row_uses_rent_dates_and_the_deposit(): void
    {
        $this->rentContract();

        $row = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/installments-summary')
            ->assertOk()
            ->json('data.0');

        $this->assertSame('rent', $row['type']);
        $this->assertSame(0.0, (float) $row['unit_price']);
        $this->assertSame(5000.0, (float) $row['monthly_rent']);
        $this->assertSame(10000.0, (float) $row['security_deposit']);
        $this->assertSame('2026-02-01', $row['start_date']);
        $this->assertSame('2026-07-01', $row['end_date']);
        $this->assertSame(6, $row['total_installments']);
        $this->assertSame(30000.0, (float) $row['contract_value']);
        $this->assertSame(30000.0, (float) $row['total_remaining']);
        // The deposit is not part of the contract value; it is only an upfront balance.
        $this->assertSame(10000.0, (float) $row['upfront_remaining']);
        $this->assertNull($row['last_paid_installment']);
        $this->assertSame(1, $row['next_due_installment']['sequence_number']);
    }

    public function test_type_chips_are_counted_before_the_type_filter(): void
    {
        $this->saleContract([['due_date' => '2026-03-01', 'amount' => 15000]]);
        $this->rentContract();
        $this->rentContract();

        $response = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/installments-summary?type=rent');

        $response->assertOk()->assertJsonCount(2, 'data');
        $response->assertJsonPath('meta.counts.all', 3);
        $response->assertJsonPath('meta.counts.sale', 1);
        $response->assertJsonPath('meta.counts.rent', 2);
        $response->assertJsonPath('meta.total', 2);
    }

    public function test_building_client_and_status_filters_narrow_the_rows(): void
    {
        $building = Building::create([
            'name' => 'Tower', 'number' => 'T1', 'type' => 'tower', 'area' => 1000, 'floors_count' => 3, 'has_basement' => false,
        ]);
        $client = $this->client();
        $this->saleContract([['due_date' => '2026-03-01', 'amount' => 15000]], 30000, $this->unit($building), $client);
        $other = $this->rentContract();

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/installments-summary?building_id=' . $building->id)
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.client_id', $client->id);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/installments-summary?client_id=' . $client->id)
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/contracts/{$other->id}/cancel", ['cancellation_reason' => 'طلب العميل'])
            ->assertOk();

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/installments-summary?status=cancelled')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status', 'cancelled');

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/installments-summary?status=active')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status', 'active');
    }

    public function test_a_draft_contract_is_not_listed(): void
    {
        $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'client_id' => $this->client()->id,
            'unit_id' => $this->unit()->id,
            'contract_date' => '2026-02-01',
            'total_price' => 60000,
            'agreed_down_payment' => 30000,
            'status' => 'draft',
            'schedule' => [['due_date' => '2026-03-01', 'amount' => 15000]],
        ])->assertStatus(201);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/installments-summary')
            ->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('meta.counts.all', 0);
    }

    public function test_the_report_needs_the_reports_permission(): void
    {
        $user = User::create([
            'name' => 'Regular',
            'username' => 'regular',
            'password' => bcrypt('password123'),
            'status' => 'active',
            'lock_version' => 0,
        ]);
        $token = $this->postJson('/api/v1/auth/login', [
            'login' => 'regular',
            'password' => 'password123',
        ])->json('data.token');

        $this->withHeaders(['Authorization' => 'Bearer ' . $token])
            ->getJson('/api/v1/admin/reports/installments-summary')
            ->assertStatus(403);
    }
}
