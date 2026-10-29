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
use App\Support\Clock\FrozenClock;
use Tests\TestCase;

/**
 * «الأقساط المستحقة والمتأخرة»: unpaid installments of active contracts that are due today or already
 * late, with the delay buckets (0-30 / 31-60 / 61-90 / +90), the bucket rollups and the «يستحق خلال
 * 7 أيام» figure.
 */
class DueOverdueReportTest extends TestCase
{
    private User $admin;

    private string $token;

    private static int $sequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        // Buckets are relative to today, so the whole test runs on a frozen day.
        FrozenClock::parse('2026-09-01 10:00:00');

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
    private function saleContract(array $schedule, ?Unit $unit = null, ?Client $client = null): Contract
    {
        $id = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'client_id' => ($client ?? $this->client())->id,
            'unit_id' => ($unit ?? $this->unit())->id,
            'contract_date' => '2026-02-01',
            'total_price' => array_sum(array_column($schedule, 'amount')) + 10000,
            'agreed_down_payment' => 10000,
            'schedule' => $schedule,
        ])->assertStatus(201)->json('data.id');

        return Contract::findOrFail($id);
    }

    /** @param  array<int, int>  $installmentAmounts  1-based sequence => amount */
    private function pay(Contract $contract, array $installmentAmounts, string $paidAt = '2026-06-01'): void
    {
        $installments = $contract->installments()->orderBy('sequence_number')->get();
        $payload = ['contract_id' => $contract->id, 'paid_at' => $paidAt, 'installments' => []];
        foreach ($installmentAmounts as $sequence => $amount) {
            $payload['installments'][] = ['installment_id' => $installments[$sequence - 1]->id, 'amount' => $amount];
        }

        $this->withHeaders($this->headers())
            ->postJson('/api/v1/admin/receipts', $payload)
            ->assertStatus(201);
    }

    public function test_due_and_overdue_rows_are_bucketed_by_days_late(): void
    {
        $this->saleContract([
            ['due_date' => '2026-05-01', 'amount' => 50000],   // 123 days late  -> +90
            ['due_date' => '2026-06-30', 'amount' => 40000],   //  63 days late  -> 61-90
            ['due_date' => '2026-08-01', 'amount' => 30000],   //  31 days late  -> 31-60
            ['due_date' => '2026-09-01', 'amount' => 20000],   //  due today     -> 0-30
            ['due_date' => '2026-09-05', 'amount' => 10000],   //  this week     -> hidden from the table
            ['due_date' => '2026-10-01', 'amount' => 6000],    //  later on      -> hidden from both
        ]);

        $response = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/due-overdue');

        $response->assertOk();
        $data = $response->json('data');
        $meta = $response->json('meta');

        // The future row is excluded; nothing is paid, so every remaining row is due or late.
        $this->assertCount(4, $data);
        $this->assertSame(
            ['2026-05-01', '2026-06-30', '2026-08-01', '2026-09-01'],
            array_column($data, 'due_date')
        );
        $this->assertSame([123, 63, 31, 0], array_column($data, 'days_overdue'));
        $this->assertSame(['90+', '61-90', '31-60', '0-30'], array_column($data, 'bucket'));
        $this->assertSame(50000.0, (float) $data[0]['remaining']);
        $this->assertSame(0.0, (float) $data[0]['paid_amount']);

        $this->assertSame(4, $meta['total']);
        $this->assertSame(['count' => 4, 'total' => 140000.0], [
            'count' => $meta['buckets']['all']['count'],
            'total' => (float) $meta['buckets']['all']['total'],
        ]);
        $this->assertSame(50000.0, (float) $meta['buckets']['90+']['total']);
        $this->assertSame(40000.0, (float) $meta['buckets']['61-90']['total']);
        $this->assertSame(30000.0, (float) $meta['buckets']['31-60']['total']);
        $this->assertSame(20000.0, (float) $meta['buckets']['0-30']['total']);
        $this->assertSame(1, $meta['buckets']['90+']['count']);

        // Tomorrow..7 days: only the 2026-09-05 row; the 2026-10-01 one is further out.
        $this->assertSame(1, $meta['due_within_7_days']['count']);
        $this->assertSame(10000.0, (float) $meta['due_within_7_days']['total']);
    }

    public function test_paid_rows_disappear_and_partial_ones_keep_their_balance(): void
    {
        $contract = $this->saleContract([
            ['due_date' => '2026-07-01', 'amount' => 20000],
            ['due_date' => '2026-08-01', 'amount' => 20000],
        ]);
        // Row 1 fully collected, row 2 only partly.
        $this->pay($contract, [1 => 20000, 2 => 5000]);

        $data = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/due-overdue')
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $data);
        $this->assertSame(2, $data[0]['sequence_number']);
        $this->assertSame(20000.0, (float) $data[0]['amount']);
        $this->assertSame(5000.0, (float) $data[0]['paid_amount']);
        $this->assertSame(15000.0, (float) $data[0]['remaining']);
    }

    public function test_only_active_contracts_are_listed(): void
    {
        $cancelled = $this->saleContract([['due_date' => '2026-07-01', 'amount' => 20000]]);
        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/contracts/{$cancelled->id}/cancel", ['cancellation_reason' => 'طلب العميل'])
            ->assertOk();

        // A draft has no installments at all, so it can never show up here.
        $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'client_id' => $this->client()->id,
            'unit_id' => $this->unit()->id,
            'contract_date' => '2026-02-01',
            'total_price' => 30000,
            'agreed_down_payment' => 10000,
            'status' => 'draft',
            'schedule' => [['due_date' => '2026-07-01', 'amount' => 20000]],
        ])->assertStatus(201);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/due-overdue')
            ->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('meta.buckets.all.count', 0);
    }

    public function test_building_client_and_bucket_filters_narrow_the_rows_but_not_the_chips(): void
    {
        $building = Building::create([
            'name' => 'Tower', 'number' => 'T1', 'type' => 'tower', 'area' => 1000, 'floors_count' => 3, 'has_basement' => false,
        ]);
        $client = $this->client();
        $this->saleContract([
            ['due_date' => '2026-05-01', 'amount' => 40000],
            ['due_date' => '2026-08-20', 'amount' => 10000],
        ], $this->unit($building), $client);
        $other = $this->saleContract([['due_date' => '2026-08-25', 'amount' => 7000]]);

        // Building + client filters.
        $response = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/due-overdue?building_id=' . $building->id);
        $response->assertOk()->assertJsonCount(2, 'data');
        $this->assertSame($client->id, $response->json('data.0.client_id'));

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/due-overdue?client_id=' . $other->client_id)
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.contract_number', $other->number);

        // A bucket narrows the table only; the chips still count the whole scope.
        $meta = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/due-overdue?bucket=90%2B')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.due_date', '2026-05-01')
            ->json('meta');

        $this->assertSame(3, $meta['buckets']['all']['count']);
        $this->assertSame(40000.0, (float) $meta['buckets']['90+']['total']);
        $this->assertSame(1, $meta['total']);
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
            ->getJson('/api/v1/admin/reports/due-overdue')
            ->assertStatus(403);
    }
}
