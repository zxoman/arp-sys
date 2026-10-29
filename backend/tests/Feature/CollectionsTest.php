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
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Collection (التحصيل): the rent-due page lists every installment and down payment of the active
 * contracts (server-side filters, counts, totals and a month calendar), and the header bell lists
 * the installments that are overdue or fall due today.
 */
class CollectionsTest extends TestCase
{
    private User $admin;

    private string $token;

    private static int $sequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        // The page recomputes «متأخر» against today, so the test date is fixed around the schedules.
        Carbon::setTestNow(Carbon::parse('2026-03-15 10:00:00'));

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

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    private function headers(): array
    {
        return ['Authorization' => 'Bearer ' . $this->token];
    }

    private function unit(): Unit
    {
        $n = ++self::$sequence;

        $building = Building::create([
            'name' => 'Building ' . $n,
            'number' => 'B' . $n,
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

    /**
     * An active contract through the API. Sale contracts get a total that matches schedule + down
     * payment; rent contracts get the minimum lease terms.
     *
     * @param  array<int, array{due_date: string, amount: int}>  $schedule
     */
    private function contract(
        string $type = 'sale',
        array $schedule = [],
        float $downPayment = 30000,
        string $contractDate = '2026-02-01',
        ?Client $client = null,
        ?int $reservationId = null,
        ?Unit $unit = null,
    ): Contract {
        $total = array_sum(array_column($schedule, 'amount'));

        $payload = [
            'type' => $type,
            'client_id' => ($client ?? $this->client())->id,
            'unit_id' => ($unit ?? $this->unit())->id,
            'contract_date' => $contractDate,
            'agreed_down_payment' => $downPayment,
            'schedule' => $schedule,
            'total_price' => $type === 'sale' ? $total + $downPayment : $total,
        ];
        if ($reservationId !== null) {
            $payload['reservation_id'] = $reservationId;
        }
        if ($type === 'rent') {
            $payload += [
                'monthly_rent' => 5000,
                'duration_months' => 6,
                'start_date' => $contractDate,
            ];
        }

        $id = $this->withHeaders($this->headers())
            ->postJson('/api/v1/admin/contracts', $payload)
            ->assertStatus(201)
            ->json('data.id');

        return Contract::findOrFail($id);
    }

    private function pay(Contract $contract, array $installmentAmounts, ?float $downPayment = null): void
    {
        $installments = $contract->installments()->orderBy('sequence_number')->get();
        $lines = [];
        foreach ($installmentAmounts as $sequence => $amount) {
            $lines[] = ['installment_id' => $installments[$sequence - 1]->id, 'amount' => $amount];
        }

        $payload = ['contract_id' => $contract->id, 'paid_at' => '2026-03-10', 'installments' => $lines];
        if ($downPayment !== null) {
            $payload['down_payment'] = $downPayment;
        }

        $this->withHeaders($this->headers())
            ->postJson('/api/v1/admin/receipts', $payload)
            ->assertStatus(201);
    }

    public function test_installments_list_reports_display_status_counts_and_totals(): void
    {
        $contract = $this->contract('sale', [
            ['due_date' => '2026-03-01', 'amount' => 15000],
            ['due_date' => '2026-03-15', 'amount' => 15000],
            ['due_date' => '2026-04-01', 'amount' => 15000],
            ['due_date' => '2026-05-01', 'amount' => 15000],
        ]);
        // #2 is due today and partially paid, #4 is fully paid.
        $this->pay($contract, [2 => 5000, 4 => 15000]);

        $response = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/installments?per_page=10');

        $response->assertOk()->assertJsonCount(4, 'data');
        $response->assertJsonPath('data.0.sequence_number', 1);
        $response->assertJsonPath('data.0.status', 'overdue');
        $response->assertJsonPath('data.1.status', 'partially_paid');
        $response->assertJsonPath('data.1.remaining', '10000.00');
        $response->assertJsonPath('data.2.status', 'due');
        $response->assertJsonPath('data.3.status', 'paid');

        $response->assertJsonPath('meta.counts.all', 4);
        $response->assertJsonPath('meta.counts.overdue', 1);
        $response->assertJsonPath('meta.counts.partially_paid', 1);
        $response->assertJsonPath('meta.counts.due', 1);
        $response->assertJsonPath('meta.counts.paid', 1);
        $response->assertJsonPath('meta.totals.amount', '60000.00');
        $response->assertJsonPath('meta.totals.paid', '20000.00');
        $response->assertJsonPath('meta.totals.remaining', '40000.00');
        $response->assertJsonPath('meta.totals.overdue', '15000.00');
    }

    public function test_installments_status_and_day_filters_do_not_change_the_chips(): void
    {
        $contract = $this->contract('sale', [
            ['due_date' => '2026-03-01', 'amount' => 15000],
            ['due_date' => '2026-03-15', 'amount' => 15000],
            ['due_date' => '2026-04-01', 'amount' => 15000],
        ]);
        $this->pay($contract, [2 => 5000]);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/installments?status=paid')
            ->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('meta.counts.overdue', 1);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/installments?status=overdue')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.sequence_number', 1);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/installments?due_on=2026-03-15')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.sequence_number', 2)
            ->assertJsonPath('meta.counts.all', 3);
    }

    public function test_type_chips_are_counted_before_the_type_filter(): void
    {
        $this->contract('sale', [
            ['due_date' => '2026-04-01', 'amount' => 15000],
            ['due_date' => '2026-05-01', 'amount' => 15000],
        ]);
        $this->contract('rent', [
            ['due_date' => '2026-04-01', 'amount' => 5000],
            ['due_date' => '2026-05-01', 'amount' => 5000],
            ['due_date' => '2026-06-01', 'amount' => 5000],
        ], 0, '2026-03-01');

        $response = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/installments?type=rent');

        $response->assertOk()->assertJsonCount(3, 'data');
        $response->assertJsonPath('meta.type_counts.all', 5);
        $response->assertJsonPath('meta.type_counts.sale', 2);
        $response->assertJsonPath('meta.type_counts.rent', 3);
        $response->assertJsonPath('meta.counts.all', 3);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/installments?search=' . $this->contractSearchNumber())
            ->assertOk()
            ->assertJsonCount(3, 'data');
    }

    /** The last created contract's number (search matches contract number / client / unit / building). */
    private function contractSearchNumber(): string
    {
        return Contract::query()->latest('id')->firstOrFail()->number;
    }

    public function test_month_calendar_rolls_up_installments_per_day(): void
    {
        $contract = $this->contract('sale', [
            ['due_date' => '2026-03-01', 'amount' => 15000],
            ['due_date' => '2026-03-15', 'amount' => 15000],
            ['due_date' => '2026-03-15', 'amount' => 15000],
        ]);
        $this->pay($contract, [3 => 15000]);

        $response = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/installments/calendar?month=2026-03');

        $response->assertOk()
            ->assertJsonPath('data.month', '2026-03')
            ->assertJsonPath('data.days.0.date', '2026-03-01')
            ->assertJsonPath('data.days.0.overdue', 1)
            ->assertJsonPath('data.days.0.due', 0)
            ->assertJsonPath('data.days.1.date', '2026-03-15')
            ->assertJsonPath('data.days.1.total', 2)
            ->assertJsonPath('data.days.1.due', 1)
            ->assertJsonPath('data.days.1.paid', 1);
    }

    public function test_down_payments_show_the_paid_and_remaining_amount(): void
    {
        $contract = $this->contract('sale', [
            ['due_date' => '2026-04-01', 'amount' => 15000],
            ['due_date' => '2026-05-01', 'amount' => 15000],
        ]);
        $this->pay($contract, [], 12000);

        $response = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/down-payments');

        $response->assertOk()->assertJsonCount(1, 'data');
        $response->assertJsonPath('data.0.kind', 'down_payment');
        $response->assertJsonPath('data.0.sequence_number', 0);
        $response->assertJsonPath('data.0.due_date', '2026-02-01');
        $response->assertJsonPath('data.0.amount', '30000.00');
        $response->assertJsonPath('data.0.paid_amount', '12000.00');
        $response->assertJsonPath('data.0.remaining', '18000.00');
        $response->assertJsonPath('data.0.status', 'overdue');
        $response->assertJsonPath('meta.counts.overdue', 1);
        $response->assertJsonPath('meta.totals.paid', '12000.00');
        $response->assertJsonPath('meta.totals.remaining', '18000.00');

        $this->pay($contract->fresh(), [], 18000);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/down-payments')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'paid')
            ->assertJsonPath('data.0.remaining', '0.00')
            ->assertJsonPath('meta.counts.paid', 1)
            ->assertJsonPath('meta.counts.overdue', 0)
            ->assertJsonPath('meta.totals.remaining', '0.00');
    }

    public function test_a_reservation_deposit_counts_towards_the_down_payment(): void
    {
        $unit = $this->unit();
        $client = $this->client();

        $reservationId = $this->withHeaders($this->headers())
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $unit->id,
                'reservation_date' => '2026-02-01',
            ])
            ->assertStatus(201)
            ->json('data.id');

        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/reservations/{$reservationId}/payments", [
                'amount' => 5000,
                'paid_at' => '2026-02-02',
            ])
            ->assertStatus(201);

        $this->contract('sale', [
            ['due_date' => '2026-04-01', 'amount' => 15000],
        ], 30000, '2026-02-01', $client, $reservationId, $unit);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/down-payments')
            ->assertOk()
            ->assertJsonPath('data.0.paid_amount', '5000.00')
            ->assertJsonPath('data.0.remaining', '25000.00')
            ->assertJsonPath('data.0.status', 'overdue');
    }

    public function test_down_payments_can_be_filtered_by_status_and_month(): void
    {
        $this->contract('sale', [['due_date' => '2026-04-01', 'amount' => 15000]]);
        $future = $this->contract('sale', [['due_date' => '2026-05-01', 'amount' => 15000]], 30000, '2026-03-20');
        $this->pay($future, [], 30000);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/down-payments?status=paid')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.contract_id', $future->id);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/down-payments/calendar?month=2026-02')
            ->assertOk()
            ->assertJsonPath('data.days.0.date', '2026-02-01')
            ->assertJsonPath('data.days.0.overdue', 1);
    }

    public function test_notifications_list_overdue_and_due_today_installments_only(): void
    {
        $contract = $this->contract('sale', [
            ['due_date' => '2026-02-20', 'amount' => 15000],
            ['due_date' => '2026-03-15', 'amount' => 15000],
            ['due_date' => '2026-04-01', 'amount' => 15000],
            ['due_date' => '2026-05-01', 'amount' => 15000],
        ]);
        $this->pay($contract, [4 => 15000]);

        $response = $this->withHeaders($this->headers())->getJson('/api/v1/admin/notifications');

        $response->assertOk()
            ->assertJsonPath('data.0.id', 'overdue')
            ->assertJsonPath('data.0.total', 1)
            ->assertJsonPath('data.0.items.0.key', 'installment:' . $contract->installments()->orderBy('sequence_number')->first()->id)
            ->assertJsonPath('data.0.items.0.days_overdue', 23)
            ->assertJsonPath('data.1.id', 'due-today')
            ->assertJsonPath('data.1.total', 1)
            ->assertJsonPath('data.1.items.0.sequence_number', 2)
            ->assertJsonPath('meta.total', 2);
    }

    public function test_a_cancelled_contract_sends_no_alerts_and_a_draft_has_no_rows(): void
    {
        $contract = $this->contract('sale', [
            ['due_date' => '2026-02-20', 'amount' => 15000],
            ['due_date' => '2026-03-15', 'amount' => 15000],
        ]);

        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/contracts/{$contract->id}/cancel", ['cancellation_reason' => 'طلب العميل'])
            ->assertOk();

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/notifications')
            ->assertOk()
            ->assertJsonPath('data.0.total', 0)
            ->assertJsonPath('data.1.total', 0)
            ->assertJsonPath('meta.total', 0);

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/installments')
            ->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('meta.counts.all', 0);
    }

    public function test_collections_need_the_contracts_permission(): void
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
        $headers = ['Authorization' => 'Bearer ' . $token];

        $this->withHeaders($headers)->getJson('/api/v1/admin/installments')->assertStatus(403);
        $this->withHeaders($headers)->getJson('/api/v1/admin/down-payments')->assertStatus(403);
        $this->withHeaders($headers)->getJson('/api/v1/admin/notifications')->assertStatus(403);
        $this->withHeaders($headers)->getJson('/api/v1/admin/installments/calendar')->assertStatus(403);
    }
}
