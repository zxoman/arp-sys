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
 * «حالة الوحدات»: the units of the project grouped by their state, with the money each state is
 * worth and the filters that narrow the list.
 */
class UnitStatusTest extends TestCase
{
    private User $admin;

    private string $token;

    private static int $sequence = 0;

    private Building $building;

    private Floor $floor;

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
        $this->floor = Floor::create([
            'building_id' => $this->building->id,
            'floor_number' => 2,
            'display_name' => 'الثاني',
            'units_count' => 0,
        ]);
    }

    private function headers(): array
    {
        return ['Authorization' => 'Bearer '.$this->token];
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

    /** @param  array<string, mixed>  $overrides */
    private function unit(array $overrides = []): Unit
    {
        static $n = 0;
        $n++;

        return Unit::create(array_merge([
            'building_id' => $this->building->id,
            'floor_id' => $this->floor->id,
            'name' => 'Unit '.$n,
            'type' => 'apartment',
            'activity' => 'residential',
            'purpose' => 'both',
            'area' => 100,
            'price_per_meter' => 5000,
            'is_sellable' => true,
            'status' => 'available',
        ], $overrides));
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
    private function report(string $query = ''): array
    {
        return $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/reports/unit-status'.($query === '' ? '' : '?'.$query))
            ->assertOk()
            ->json('data');
    }

    /** @param  list<array<string, mixed>>  $rows */
    private function keyedByUnit(array $rows): array
    {
        return array_column($rows, null, 'name');
    }

    public function test_every_unit_is_counted_by_its_state_with_its_money(): void
    {
        $available = $this->unit(['name' => 'A-101']);
        $sold = $this->unit(['name' => 'A-102']);
        $rented = $this->unit(['name' => 'A-103', 'purpose' => 'rent', 'price_per_meter' => null]);
        $closed = $this->unit([
            'name' => 'A-104',
            'is_sellable' => false,
            'non_sellable_reason' => 'ممر للخدمة',
        ]);

        $buyer = $this->client();
        $saleContract = $this->contract([
            'type' => 'sale',
            'client_id' => $buyer->id,
            'unit_id' => $sold->id,
            'contract_date' => '2026-01-01',
            'total_price' => 400000,
            'agreed_down_payment' => 100000,
            'schedule' => [['due_date' => '2026-07-01', 'amount' => 300000]],
        ]);

        $tenant = $this->client();
        $lease = $this->contract([
            'type' => 'rent',
            'client_id' => $tenant->id,
            'unit_id' => $rented->id,
            'contract_date' => '2026-01-01',
            'monthly_rent' => 5000,
            'duration_months' => 12,
            'start_date' => '2026-02-01',
            'end_date' => '2027-01-31',
            'security_deposit' => 10000,
            'schedule' => [['due_date' => '2026-02-01', 'amount' => 60000]],
        ]);

        $data = $this->report();

        $this->assertSame(4, $data['counts']['total']);
        $this->assertSame(1, $data['counts']['available']);
        $this->assertSame(0, $data['counts']['reserved']);
        $this->assertSame(1, $data['counts']['sold']);
        $this->assertSame(1, $data['counts']['rented']);
        // A sellable flag off an available unit makes it «مغلقة», not «متاحة».
        $this->assertSame(1, $data['counts']['closed']);

        $rows = $this->keyedByUnit($data['units']);

        $this->assertSame('available', $rows['A-101']['status']);
        $this->assertSame('both', $rows['A-101']['purpose']);
        $this->assertSame(500000.0, (float) $rows['A-101']['sale_price']);
        $this->assertNull($rows['A-101']['contract_id']);
        $this->assertNull($rows['A-101']['client_id']);

        $this->assertSame('sold', $rows['A-102']['status']);
        $this->assertSame($saleContract->number, $rows['A-102']['contract_number']);
        $this->assertSame('sale', $rows['A-102']['contract_type']);
        $this->assertSame($buyer->name, $rows['A-102']['client_name']);
        // A sold unit is worth the contract's net price, not the listed one.
        $this->assertSame(400000.0, (float) $rows['A-102']['sale_price']);
        $this->assertNull($rows['A-102']['monthly_rent']);

        $this->assertSame('rented', $rows['A-103']['status']);
        $this->assertSame($tenant->name, $rows['A-103']['client_name']);
        $this->assertSame($lease->number, $rows['A-103']['contract_number']);
        $this->assertSame(5000.0, (float) $rows['A-103']['monthly_rent']);
        $this->assertSame('2027-01-31', $rows['A-103']['contract_end_date']);
        // Rent-only: it has no sale value at all.
        $this->assertNull($rows['A-103']['sale_price']);

        $this->assertTrue($rows['A-104']['is_closed']);
        $this->assertFalse($rows['A-104']['is_sellable']);
        $this->assertSame('ممر للخدمة', $rows['A-104']['non_sellable_reason']);

        // 4 × 100 م²; the sale value skips the rent-only unit.
        $this->assertSame(400.0, (float) $data['totals']['area']);
        $this->assertSame(300.0, (float) $data['totals']['sale_area']);
        $this->assertSame(1400000.0, (float) $data['totals']['sale_value']);
        $this->assertSame(5000.0, (float) $data['totals']['monthly_rent']);

        $this->assertCount(1, $data['by_building']);
        $building = $data['by_building'][0];
        $this->assertSame($this->building->id, $building['id']);
        $this->assertSame(4, $building['total']);
        $this->assertSame(1, $building['sold']);
        $this->assertSame(1, $building['closed']);
        $this->assertSame(1400000.0, (float) $building['sale_value']);
    }

    public function test_a_reserved_unit_keeps_its_client_and_deposit(): void
    {
        $unit = $this->unit(['name' => 'R-1']);
        $client = $this->client();
        $reservation = Reservation::create([
            'client_id' => $client->id,
            'building_id' => $this->building->id,
            'unit_id' => $unit->id,
            'reservation_date' => '2026-05-10',
            'status' => 'active',
        ]);
        ReservationPayment::create([
            'reservation_id' => $reservation->id,
            'amount' => 3000,
            'paid_at' => '2026-05-10',
            'status' => 'valid',
            'created_by' => $this->admin->id,
        ]);
        $unit->update(['status' => 'reserved']);

        $row = $this->keyedByUnit($this->report()['units'])['R-1'];

        $this->assertSame('reserved', $row['status']);
        $this->assertSame($client->name, $row['client_name']);
        $this->assertSame('2026-05-10', $row['reservation_date']);
        $this->assertSame(3000.0, (float) $row['deposit_paid']);
        $this->assertNull($row['contract_id']);
    }

    public function test_the_filters_narrow_the_units(): void
    {
        $this->unit(['name' => 'F-101', 'type' => 'apartment', 'purpose' => 'sale']);

        $thirdFloor = Floor::create([
            'building_id' => $this->building->id,
            'floor_number' => 3,
            'display_name' => 'الثالث',
            'units_count' => 0,
        ]);
        $this->unit(['name' => 'F-102', 'type' => 'shop', 'purpose' => 'rent', 'floor_id' => $thirdFloor->id]);

        $other = $this->makeBuilding();
        $otherFloor = Floor::create([
            'building_id' => $other->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);
        Unit::create([
            'building_id' => $other->id,
            'floor_id' => $otherFloor->id,
            'name' => 'O-1',
            'type' => 'studio',
            'activity' => 'residential',
            'purpose' => 'both',
            'area' => 50,
            'price_per_meter' => 4000,
            'is_sellable' => true,
            'status' => 'available',
        ]);

        $this->assertCount(3, $this->report()['units']);

        $byBuilding = $this->report('building_id='.$this->building->id);
        $this->assertCount(2, $byBuilding['units']);
        $this->assertSame($this->building->id, $byBuilding['filters']['building_id']);

        $this->assertSame(['F-102'], array_column($this->report('type=shop')['units'], 'name'));
        $this->assertSame(['F-101'], array_column($this->report('purpose=sale')['units'], 'name'));
        $this->assertSame(['F-101'], array_column($this->report('floor_id='.$this->floor->id)['units'], 'name'));

        // The rollups describe the filtered set only.
        $shops = $this->report('type=shop');
        $this->assertSame(1, $shops['counts']['total']);
        $this->assertCount(1, $shops['by_building']);
    }

    public function test_a_cancelled_contract_gives_the_unit_back(): void
    {
        $unit = $this->unit(['name' => 'C-1']);
        $contract = $this->contract([
            'type' => 'sale',
            'client_id' => $this->client()->id,
            'unit_id' => $unit->id,
            'contract_date' => '2026-01-01',
            'total_price' => 400000,
            'agreed_down_payment' => 0,
            'schedule' => [['due_date' => '2026-07-01', 'amount' => 400000]],
        ]);

        $this->assertSame('sold', $this->keyedByUnit($this->report()['units'])['C-1']['status']);

        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/contracts/{$contract->id}/cancel", ['cancellation_reason' => 'طلب العميل'])
            ->assertOk();

        $data = $this->report();
        $row = $this->keyedByUnit($data['units'])['C-1'];

        $this->assertSame('available', $row['status']);
        $this->assertNull($row['contract_id']);
        $this->assertNull($row['client_id']);
        // There is no «مرتجعة» state in the API: the unit is simply available again.
        $this->assertSame(['total', 'available', 'reserved', 'sold', 'rented', 'closed'], array_keys($data['counts']));
        $this->assertSame(1, $data['counts']['available']);
        $this->assertSame(0, $data['counts']['sold']);
    }
}
