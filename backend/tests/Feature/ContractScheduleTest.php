<?php

namespace Tests\Feature;

use App\Models\Building;
use App\Models\BuildingActivity;
use App\Models\Client;
use App\Models\Floor;
use App\Models\Reservation;
use App\Models\Role;
use App\Models\RolePermission;
use App\Models\Unit;
use App\Models\User;
use Tests\TestCase;

/**
 * The contract shapes the contracts screen sends: a free schedule, a company discount, a draft that is
 * posted later, and the lease terms (rent, term, deposit, advance months, yearly increase).
 */
class ContractScheduleTest extends TestCase
{
    private User $admin;

    private string $token;

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

    private static int $sequence = 0;

    private function unit(string $purpose = 'both'): Unit
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
            'purpose' => $purpose,
            'area' => 100,
            'price_per_meter' => 5000,
            'is_sellable' => true,
            'status' => 'available',
        ]);
    }

    private function client(string $name = 'Client'): Client
    {
        return Client::create(['name' => $name, 'phone' => '+201000000' . random_int(100, 999)]);
    }

    public function test_sale_contract_takes_the_schedule_and_discount_as_sent(): void
    {
        $unit = $this->unit();
        $client = $this->client();

        $response = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $unit->id,
            'contract_date' => '2026-01-10',
            'total_price' => 950000,
            'discount' => 50000,
            'discount_reason' => 'سداد نقدي',
            'agreed_down_payment' => 200000,
            'schedule' => [
                ['due_date' => '2026-03-01', 'amount' => 250000],
                ['due_date' => '2026-09-01', 'amount' => 250000],
                ['due_date' => '2027-03-01', 'amount' => 250000],
            ],
        ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.discount', '50000.00');
        $response->assertJsonPath('data.discount_reason', 'سداد نقدي');
        $response->assertJsonPath('data.installments_count', 3);
        $response->assertJsonPath('data.contract_value', 950000);
        $response->assertJsonPath('data.first_installment_date', '2026-03-01T00:00:00.000000Z');

        $this->assertDatabaseHas('installments', ['due_date' => '2026-09-01 00:00:00', 'amount' => 250000]);
        $this->assertDatabaseHas('units', ['id' => $unit->id, 'status' => 'sold']);
    }

    public function test_draft_keeps_the_schedule_and_changes_nothing_until_posted(): void
    {
        $unit = $this->unit();
        $client = $this->client();
        $reservation = Reservation::create([
            'client_id' => $client->id,
            'building_id' => $unit->building_id,
            'unit_id' => $unit->id,
            'unit_type' => 'apartment',
            'unit_activity' => 'residential',
            'reservation_date' => '2026-01-01',
            'status' => 'active',
        ]);
        $unit->update(['status' => 'reserved']);

        $response = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'status' => 'draft',
            'reservation_id' => $reservation->id,
            'client_id' => $client->id,
            'unit_id' => $unit->id,
            'contract_date' => '2026-01-10',
            'total_price' => 900000,
            'agreed_down_payment' => 100000,
            'schedule' => [
                ['due_date' => '2026-04-01', 'amount' => 400000],
                ['due_date' => '2026-10-01', 'amount' => 400000],
            ],
        ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.status', 'draft');
        $response->assertJsonPath('data.installments_count', 0);
        $this->assertDatabaseCount('installments', 0);
        $this->assertDatabaseHas('units', ['id' => $unit->id, 'status' => 'reserved']);
        $this->assertDatabaseHas('reservations', ['id' => $reservation->id, 'status' => 'active']);

        $contractId = $response->json('data.id');

        $post = $this->withHeaders($this->headers())->postJson("/api/v1/admin/contracts/{$contractId}/post", [
            'schedule' => [
                ['due_date' => '2026-05-01', 'amount' => 500000],
                ['due_date' => '2026-11-01', 'amount' => 300000],
            ],
        ]);

        $post->assertStatus(200);
        $post->assertJsonPath('data.status', 'active');
        $post->assertJsonPath('data.installments_count', 2);
        $this->assertDatabaseCount('installments', 2);
        $this->assertDatabaseHas('installments', ['contract_id' => $contractId, 'due_date' => '2026-05-01 00:00:00', 'amount' => 500000]);
        $this->assertDatabaseHas('units', ['id' => $unit->id, 'status' => 'sold']);
        $this->assertDatabaseHas('reservations', ['id' => $reservation->id, 'status' => 'converted']);
    }

    public function test_posting_an_active_contract_is_rejected(): void
    {
        $unit = $this->unit();
        $client = $this->client();

        $id = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $unit->id,
            'contract_date' => '2026-01-10',
            'total_price' => 500000,
        ])->json('data.id');

        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/contracts/{$id}/post")
            ->assertStatus(422);
    }

    public function test_rent_contract_stores_the_lease_terms_and_totals_the_schedule(): void
    {
        $unit = $this->unit('rent');
        $client = $this->client('مستأجر');

        $response = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'rent',
            'client_id' => $client->id,
            'unit_id' => $unit->id,
            'contract_date' => '2026-01-01',
            'monthly_rent' => 10000,
            'duration_months' => 12,
            'start_date' => '2026-02-01',
            'security_deposit' => 20000,
            'advance_months' => 2,
            'annual_increase_pct' => 10,
            'increase_from_year' => 2,
            'schedule' => [
                ['due_date' => '2026-01-01', 'amount' => 20000],
                ['due_date' => '2026-02-01', 'amount' => 100000],
                ['due_date' => '2027-02-01', 'amount' => 120000],
            ],
        ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.total_price', '240000.00');
        $response->assertJsonPath('data.monthly_rent', '10000.00');
        $response->assertJsonPath('data.duration_months', 12);
        $response->assertJsonPath('data.security_deposit', '20000.00');
        $response->assertJsonPath('data.advance_months', 2);
        $response->assertJsonPath('data.annual_increase_pct', '10.00');
        $response->assertJsonPath('data.end_date', '2027-01-01T00:00:00.000000Z');
        $response->assertJsonPath('data.installments_count', 3);
        $this->assertDatabaseHas('units', ['id' => $unit->id, 'status' => 'rented']);
    }

    public function test_rent_contract_without_schedule_generates_one_row_per_month(): void
    {
        $unit = $this->unit('rent');
        $client = $this->client();

        $response = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'rent',
            'client_id' => $client->id,
            'unit_id' => $unit->id,
            'contract_date' => '2026-03-01',
            'monthly_rent' => 5000,
            'duration_months' => 4,
            'start_date' => '2026-03-01',
        ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.installments_count', 4);
        $response->assertJsonPath('data.total_price', '20000.00');
        $this->assertDatabaseCount('installments', 4);
        $this->assertDatabaseHas('installments', ['due_date' => '2026-06-01 00:00:00', 'amount' => 5000]);
    }

    public function test_contract_list_searches_by_number_and_paginates(): void
    {
        $client = $this->client('أحمد محمود');

        foreach ([1, 2] as $i) {
            $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
                'type' => 'sale',
                'client_id' => $client->id,
                'unit_id' => $this->unit()->id,
                'contract_date' => '2026-01-0' . $i,
                'total_price' => 700000,
            ])->assertStatus(201);
        }

        $list = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/contracts?search=أحمد&page=1&per_page=15&sort=contract_date&dir=desc');

        $list->assertStatus(200);
        $list->assertJsonPath('meta.total', 2);
        $list->assertJsonPath('data.0.client_name', 'أحمد محمود');
        $this->assertSame('2026-01-02T00:00:00.000000Z', $list->json('data.0.contract_date'));

        $byNumber = $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/contracts?search=' . $list->json('data.0.number'));
        $byNumber->assertJsonPath('meta.total', 1);
    }

    public function test_cancelling_an_active_contract_cancels_its_installments_and_frees_the_unit(): void
    {
        $unit = $this->unit();
        $client = $this->client();

        $created = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $unit->id,
            'contract_date' => '2026-01-10',
            'total_price' => 300000,
            'schedule' => [
                ['due_date' => '2026-02-01', 'amount' => 150000],
                ['due_date' => '2026-03-01', 'amount' => 150000],
            ],
        ])->assertStatus(201);

        $contractId = $created->json('data.id');
        $installmentId = $created->json('data.installments.0.id');

        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/contracts/{$contractId}/cancel", ['cancellation_reason' => 'خطأ في البيانات'])
            ->assertStatus(200)
            ->assertJsonPath('data.status', 'cancelled');

        // Installments are never deleted: they follow the contract (and stop being collectable).
        $this->assertDatabaseHas('installments', ['contract_id' => $contractId, 'status' => 'cancelled']);
        $this->assertDatabaseHas('units', ['id' => $unit->id, 'status' => 'available']);

        // The details view must still serialize the cancelled schedule.
        $show = $this->withHeaders($this->headers())->getJson("/api/v1/admin/contracts/{$contractId}");
        $show->assertStatus(200);
        $show->assertJsonPath('data.status', 'cancelled');
        $show->assertJsonPath('data.installments.0.status', 'cancelled');
        $show->assertJsonPath('data.installments.0.is_overdue', false);

        $this->withHeaders($this->headers())->postJson(
            "/api/v1/admin/contracts/{$contractId}/installments/{$installmentId}/payment",
            ['amount' => 1000, 'paid_at' => '2026-02-01'],
        )->assertStatus(422);
    }

    public function test_contract_list_reports_the_type_counts_before_filtering(): void
    {
        $client = $this->client();

        foreach ([['sale', 'both'], ['sale', 'both'], ['rent', 'rent']] as [$type, $purpose]) {
            $payload = [
                'type' => $type,
                'client_id' => $client->id,
                'unit_id' => $this->unit($purpose)->id,
                'contract_date' => '2026-02-01',
                'total_price' => 500000,
            ];
            if ($type === 'rent') {
                $payload += ['monthly_rent' => 5000, 'duration_months' => 12, 'start_date' => '2026-02-01'];
                unset($payload['total_price']);
            }
            $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', $payload)->assertStatus(201);
        }

        $all = $this->withHeaders($this->headers())->getJson('/api/v1/admin/contracts');
        $all->assertJsonPath('meta.counts', ['all' => 3, 'sale' => 2, 'rent' => 1]);

        // The chips keep counting everything even while the table shows one type.
        $sale = $this->withHeaders($this->headers())->getJson('/api/v1/admin/contracts?type=sale');
        $sale->assertJsonPath('meta.total', 2);
        $sale->assertJsonPath('meta.counts.all', 3);
        $sale->assertJsonPath('meta.counts.sale', 2);
        $sale->assertJsonPath('meta.counts.rent', 1);
    }
}
