<?php

namespace Tests\Feature;

use App\Enums\Permission;
use App\Models\AuditLog;
use App\Models\Floor;
use App\Models\Role;
use App\Models\RolePermission;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Deleting a building (or a unit) is a full, permanent cascade: units, reservations with their
 * deposits, contracts with their schedule, receipts and payments all go with it — as the owner
 * decided on 2026-10-30 (see docs/DEFAULTS.md). Clients are never touched.
 */
class DeletionCascadeTest extends TestCase
{
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        $role = Role::create(['name' => 'admin', 'is_admin' => true]);
        foreach (Permission::all() as $permission) {
            RolePermission::firstOrCreate(['role_id' => $role->id, 'permission' => $permission]);
        }

        $user = User::create([
            'name' => 'Admin',
            'username' => 'admin',
            'password' => bcrypt('password123'),
            'role_id' => $role->id,
            'status' => 'active',
            'lock_version' => 0,
        ]);

        $this->token = $this->postJson('/api/v1/auth/login', [
            'login' => $user->username,
            'password' => 'password123',
        ])->json('data.token');
    }

    private function headers(): array
    {
        return ['Authorization' => 'Bearer '.$this->token];
    }

    /** A building through the API (floors are generated server-side). */
    private function building(string $name = 'برج الحذف', int $units = 2): int
    {
        return $this->withHeaders($this->headers())->postJson('/api/v1/admin/buildings', [
            'name' => $name,
            'type' => 'building',
            'city' => 'القاهرة',
            'district' => 'المعادي',
            'activities' => ['residential'],
            'floors_count' => 1,
            'total_units' => $units,
        ])->assertStatus(201)->json('data.id');
    }

    private function unit(int $buildingId, string $name): int
    {
        return $this->withHeaders($this->headers())->postJson('/api/v1/admin/units', [
            'building_id' => $buildingId,
            'floor_id' => Floor::where('building_id', $buildingId)->value('id'),
            'name' => $name,
            'type' => 'apartment',
            'activity' => 'residential',
            'area' => 100,
            'price_per_meter' => 5000,
        ])->assertStatus(201)->json('data.id');
    }

    private function client(string $name): int
    {
        return $this->withHeaders($this->headers())->postJson('/api/v1/admin/clients', [
            'name' => $name,
            'phone' => '0100000'.random_int(1000, 9999),
        ])->assertStatus(201)->json('data.id');
    }

    /** A sale contract with a down payment receipt and one paid installment. */
    private function contractWithReceipt(int $unitId, int $clientId): int
    {
        $contractId = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'client_id' => $clientId,
            'unit_id' => $unitId,
            'contract_date' => '2026-01-10',
            'total_price' => 50000,
            'agreed_down_payment' => 10000,
            'schedule' => [
                ['due_date' => '2026-02-01', 'amount' => 20000],
                ['due_date' => '2026-03-01', 'amount' => 20000],
            ],
        ])->assertStatus(201)->json('data.id');

        $first = DB::table('installments')->where('contract_id', $contractId)
            ->orderBy('sequence_number')->value('id');

        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contractId,
            'paid_at' => '2026-02-05',
            'payment_method' => 'cash',
            'installments' => [['installment_id' => $first, 'amount' => 20000]],
            'down_payment' => 10000,
        ])->assertStatus(201);

        return $contractId;
    }

    private function assertTablesEmpty(array $tables): void
    {
        foreach ($tables as $table) {
            $this->assertSame(0, DB::table($table)->count(), "{$table} should be empty after the cascade");
        }
    }

    public function test_deleting_a_building_removes_its_units_reservations_contracts_and_money(): void
    {
        $buildingId = $this->building();
        $reservedUnit = $this->unit($buildingId, '101');
        $soldUnit = $this->unit($buildingId, '102');

        // A reservation with a deposit on one unit…
        $reservationId = $this->withHeaders($this->headers())->postJson('/api/v1/admin/reservations', [
            'client_id' => $this->client('أحمد محمود'),
            'unit_id' => $reservedUnit,
            'reservation_date' => '2026-10-01',
        ])->assertStatus(201)->json('data.id');

        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/reservations/{$reservationId}/payments", [
                'amount' => 5000,
                'paid_at' => '2026-10-01',
            ])->assertStatus(201);

        // …and a contract with a receipt on the other.
        $this->contractWithReceipt($soldUnit, $this->client('سارة علي'));

        $response = $this->withHeaders($this->headers())
            ->deleteJson("/api/v1/admin/buildings/{$buildingId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.deleted.units', 2);
        $response->assertJsonPath('data.deleted.floors', 1);
        $response->assertJsonPath('data.deleted.reservations', 1);
        $response->assertJsonPath('data.deleted.deposit_payments', 1);
        $response->assertJsonPath('data.deleted.contracts', 1);
        $response->assertJsonPath('data.deleted.receipts', 1);
        $response->assertJsonPath('data.deleted.payments', 2);

        $this->assertTablesEmpty([
            'buildings', 'building_activities', 'floors', 'units',
            'reservations', 'reservation_payments',
            'contracts', 'installments', 'contract_down_payments', 'installment_payments', 'receipts',
        ]);

        // Clients are master data: deleting their deals never deletes them.
        $this->assertSame(2, DB::table('clients')->count());

        // The deletion is audited with the removed counts.
        $log = AuditLog::where('action', 'delete')->where('entity_type', 'buildings')->firstOrFail();
        $this->assertSame($buildingId, $log->entity_id);
        $this->assertSame(2, $log->meta['deleted']['units']);
        $this->assertSame(1, $log->meta['deleted']['contracts']);
    }

    public function test_deleting_one_unit_removes_its_contracts_reservations_and_money(): void
    {
        $buildingId = $this->building('برج الوحدة');
        $unitId = $this->unit($buildingId, '201');
        $keptUnit = $this->unit($buildingId, '202');

        $this->contractWithReceipt($unitId, $this->client('منى حسن'));

        $response = $this->withHeaders($this->headers())
            ->deleteJson("/api/v1/admin/units/{$unitId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.deleted.units', 1);
        $response->assertJsonPath('data.deleted.contracts', 1);
        $response->assertJsonPath('data.deleted.receipts', 1);

        $this->assertTablesEmpty(['contracts', 'installments', 'contract_down_payments', 'installment_payments', 'receipts']);
        $this->assertSame(0, DB::table('units')->where('id', $unitId)->count());
        $this->assertSame(1, DB::table('units')->where('id', $keptUnit)->count());
        $this->assertSame(1, DB::table('buildings')->where('id', $buildingId)->count());
        // The floor count follows the removal (one unit left).
        $this->assertSame(1, Floor::where('building_id', $buildingId)->value('units_count'));
    }
}
