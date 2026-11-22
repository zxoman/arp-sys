<?php

namespace Tests\Feature;

use App\Enums\Permission;
use App\Models\Building;
use App\Models\BuildingActivity;
use App\Models\Client;
use App\Models\Contract;
use App\Models\Floor;
use App\Models\Installment;
use App\Models\Reservation;
use App\Models\Role;
use App\Models\RolePermission;
use App\Models\Unit;
use App\Models\User;
use Tests\TestCase;

/**
 * Editing reservations and contracts (owner decision 2026-11-21).
 *
 * - A reservation is editable while it is active: client, unit (the old one goes back to
 *   «متاحة», the new one «محجوزة») and date. Converted/cancelled ones are locked.
 * - A contract draft is fully editable. A posted contract may move its money too, but only the rows
 *   that never collected a penny are re-planned; paid rows and receipts stay untouched, and the price
 *   may never fall below what was collected.
 */
class DealEditTest extends TestCase
{
    protected function createAdmin(): array
    {
        $role = Role::create([
            'name' => 'admin',
            'is_admin' => true,
        ]);

        foreach (Permission::all() as $permission) {
            RolePermission::firstOrCreate([
                'role_id' => $role->id,
                'permission' => $permission,
            ]);
        }

        $user = User::create([
            'name' => 'Admin',
            'username' => 'admin',
            'password' => bcrypt('password123'),
            'role_id' => $role->id,
            'status' => 'active',
            'lock_version' => 0,
        ]);

        $response = $this->postJson('/api/v1/auth/login', [
            'login' => $user->username,
            'password' => 'password123',
        ]);

        return ['user' => $user, 'token' => $response->json('data.token')];
    }

    protected function headers(array $admin): array
    {
        return ['Authorization' => 'Bearer '.$admin['token']];
    }

    protected function createBuildingAndUnit(string $number = '1', string $unitName = 'Unit 101'): array
    {
        $building = Building::create([
            'name' => 'Test Building '.$number,
            'number' => $number,
            'type' => 'building',
            'area' => 2000.00,
            'floors_count' => 5,
            'has_basement' => false,
        ]);

        BuildingActivity::create([
            'building_id' => $building->id,
            'activity' => 'residential',
        ]);

        $floor = Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 0,
        ]);

        $unit = Unit::create([
            'building_id' => $building->id,
            'floor_id' => $floor->id,
            'name' => $unitName,
            'type' => 'apartment',
            'activity' => 'residential',
            'area' => 120.00,
            'price_per_meter' => 5000.00,
            'status' => 'available',
        ]);

        return ['building' => $building, 'floor' => $floor, 'unit' => $unit];
    }

    protected function createContract(array $admin, Unit $unit, Client $client, array $payload = []): array
    {
        $response = $this->withHeaders($this->headers($admin))->postJson('/api/v1/admin/contracts', array_merge([
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $unit->id,
            'contract_date' => now()->toDateString(),
            'total_price' => 600000.00,
            'agreed_down_payment' => 100000.00,
        ], $payload));

        $response->assertStatus(201);

        return $response->json('data');
    }

    // ── Reservations ────────────────────────────────────────────────────────

    public function test_admin_can_edit_an_active_reservation(): void
    {
        $admin = $this->createAdmin();
        $first = $this->createBuildingAndUnit('1', 'Unit 101');
        $second = $this->createBuildingAndUnit('2', 'Unit 201');
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);
        $otherClient = Client::create(['name' => 'Client 2', 'phone' => '+201000000002']);

        $created = $this->withHeaders($this->headers($admin))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $first['unit']->id,
                'reservation_date' => now()->toDateString(),
            ])->json('data');

        $response = $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/reservations/'.$created['id'], [
                'client_id' => $otherClient->id,
                'unit_id' => $second['unit']->id,
                'reservation_date' => '2026-01-15',
            ]);

        $response->assertStatus(200);

        $reservation = Reservation::findOrFail($created['id']);
        $this->assertSame($otherClient->id, $reservation->client_id);
        $this->assertSame($second['unit']->id, $reservation->unit_id);
        $this->assertSame($second['building']->id, $reservation->building_id);
        $this->assertSame('2026-01-15', $reservation->reservation_date->toDateString());
        $this->assertSame('active', $reservation->status->value);

        // The old unit is free again, the new one is held by this reservation.
        $this->assertSame('available', $first['unit']->fresh()->status->value);
        $this->assertSame('reserved', $second['unit']->fresh()->status->value);

        // Money never moves through an edit.
        $this->assertDatabaseCount('reservation_payments', 0);
    }

    public function test_cannot_move_a_reservation_to_a_unit_that_is_taken(): void
    {
        $admin = $this->createAdmin();
        $first = $this->createBuildingAndUnit('1', 'Unit 101');
        $second = $this->createBuildingAndUnit('2', 'Unit 201');
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $mine = $this->withHeaders($this->headers($admin))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $first['unit']->id,
                'reservation_date' => now()->toDateString(),
            ])->json('data');

        $this->withHeaders($this->headers($admin))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $second['unit']->id,
                'reservation_date' => now()->toDateString(),
            ])->assertStatus(201);

        $response = $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/reservations/'.$mine['id'], [
                'unit_id' => $second['unit']->id,
            ]);

        $response->assertStatus(422)->assertJsonValidationErrors('unit_id');

        $this->assertSame($first['unit']->id, Reservation::findOrFail($mine['id'])->unit_id);
        $this->assertSame('reserved', $first['unit']->fresh()->status->value);
    }

    public function test_converted_and_cancelled_reservations_are_locked(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $reservation = $this->withHeaders($this->headers($admin))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'unit_id' => $data['unit']->id,
                'reservation_date' => now()->toDateString(),
            ])->json('data');

        Reservation::whereKey($reservation['id'])->update(['status' => 'converted']);

        $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/reservations/'.$reservation['id'], [
                'reservation_date' => '2026-02-01',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('reservation');

        Reservation::whereKey($reservation['id'])->update(['status' => 'cancelled']);

        $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/reservations/'.$reservation['id'], [
                'reservation_date' => '2026-03-01',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('reservation');
    }

    public function test_building_level_reservation_can_move_between_buildings(): void
    {
        $admin = $this->createAdmin();
        $first = $this->createBuildingAndUnit('1');
        $second = $this->createBuildingAndUnit('2');
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $created = $this->withHeaders($this->headers($admin))
            ->postJson('/api/v1/admin/reservations', [
                'client_id' => $client->id,
                'building_id' => $first['building']->id,
                'reservation_date' => now()->toDateString(),
            ])->json('data');

        $this->assertNull($created['unit_id']);

        $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/reservations/'.$created['id'], [
                'building_id' => $second['building']->id,
            ])
            ->assertStatus(200);

        $reservation = Reservation::findOrFail($created['id']);
        $this->assertSame($second['building']->id, $reservation->building_id);
        $this->assertNull($reservation->unit_id);
        $this->assertNull($reservation->unit_type);
    }

    // ── Contracts: drafts ───────────────────────────────────────────────────

    public function test_admin_can_edit_a_draft_contract_freely(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $draft = $this->createContract($admin, $data['unit'], $client, [
            'status' => 'draft',
            'total_price' => 500000.00,
            'agreed_down_payment' => 0,
        ]);

        $response = $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/contracts/'.$draft['id'], [
                'total_price' => 450000.00,
                'agreed_down_payment' => 50000.00,
                'installments_count' => 2,
                'first_installment_date' => now()->addMonth(1)->toDateString(),
                'interval_months' => 1,
            ]);

        $response->assertStatus(200);

        $contract = Contract::findOrFail($draft['id']);
        $this->assertSame('450000.00', $contract->total_price);
        $this->assertSame('50000.00', $contract->agreed_down_payment);
        $this->assertSame('draft', $contract->status->value);
        $this->assertCount(2, $contract->draft_schedule);
        $this->assertDatabaseCount('installments', 0);
        $this->assertSame('available', $data['unit']->fresh()->status->value);
    }

    // ── Contracts: posted ───────────────────────────────────────────────────

    public function test_editing_a_posted_contract_keeps_paid_rows_and_replans_the_rest(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $d1 = now()->addMonth(1)->toDateString();
        $d2 = now()->addMonth(2)->toDateString();
        $d3 = now()->addMonth(3)->toDateString();

        $contract = $this->createContract($admin, $data['unit'], $client, [
            'total_price' => 100000.00,
            'agreed_down_payment' => 0,
            'schedule' => [
                ['due_date' => $d1, 'amount' => 1000.00, 'paid_amount' => 1000.00],
                ['due_date' => $d2, 'amount' => 1000.00],
                ['due_date' => $d3, 'amount' => 1000.00],
            ],
        ]);

        $rows = collect($contract['installments'])->keyBy('sequence_number');

        $response = $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/contracts/'.$contract['id'], [
                'total_price' => 200000.00,
                'schedule' => [
                    // The paid row is sent with a different amount on purpose: it must not move.
                    ['installment_id' => $rows[1]['id'], 'due_date' => $d1, 'amount' => 999999.00],
                    ['installment_id' => $rows[2]['id'], 'due_date' => $d2, 'amount' => 50000.00],
                    ['installment_id' => $rows[3]['id'], 'due_date' => $d3, 'amount' => 149000.00],
                ],
            ]);

        $response->assertStatus(200);

        $paid = Installment::findOrFail($rows[1]['id']);
        $this->assertSame('1000.00', $paid->amount);
        $this->assertSame('1000.00', $paid->paid_amount);
        $this->assertSame($d1, $paid->due_date->toDateString());

        $this->assertSame('50000.00', Installment::findOrFail($rows[2]['id'])->amount);
        $this->assertSame('149000.00', Installment::findOrFail($rows[3]['id'])->amount);

        $contract = Contract::findOrFail($contract['id']);
        $this->assertSame('200000.00', $contract->total_price);
        $this->assertSame(3, $contract->installments_count);

        // The payment (and its receipt-less line) is untouched.
        $this->assertDatabaseCount('installment_payments', 1);
    }

    public function test_posted_contract_price_cannot_fall_below_what_was_collected(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $contract = $this->createContract($admin, $data['unit'], $client, [
            'total_price' => 100000.00,
            'agreed_down_payment' => 0,
            'schedule' => [
                ['due_date' => now()->addMonth(1)->toDateString(), 'amount' => 1000.00, 'paid_amount' => 1000.00],
                ['due_date' => now()->addMonth(2)->toDateString(), 'amount' => 99000.00],
            ],
        ]);

        $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/contracts/'.$contract['id'], [
                'total_price' => 500.00,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('total_price');

        $this->assertSame('100000.00', Contract::findOrFail($contract['id'])->total_price);
    }

    public function test_a_posted_contract_with_paid_rows_needs_an_explicit_schedule(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $contract = $this->createContract($admin, $data['unit'], $client, [
            'total_price' => 100000.00,
            'agreed_down_payment' => 0,
            'schedule' => [
                ['due_date' => now()->addMonth(1)->toDateString(), 'amount' => 50000.00, 'paid_amount' => 5000.00],
                ['due_date' => now()->addMonth(2)->toDateString(), 'amount' => 50000.00],
            ],
        ]);

        $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/contracts/'.$contract['id'], [
                'total_price' => 120000.00,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('schedule');
    }

    public function test_cannot_drop_a_row_that_has_payment_lines(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $contract = $this->createContract($admin, $data['unit'], $client, [
            'total_price' => 100000.00,
            'agreed_down_payment' => 0,
            'installments_count' => 2,
            'first_installment_date' => now()->addMonth(1)->toDateString(),
            'interval_months' => 1,
        ]);

        $rows = collect($contract['installments'])->keyBy('sequence_number');

        // Pay a little on the first row, then cancel it: the row owes nothing again but its payment
        // line is still on record, so the schedule may not silently drop it.
        $payment = $this->withHeaders($this->headers($admin))
            ->postJson('/api/v1/admin/contracts/'.$contract['id'].'/installments/'.$rows[1]['id'].'/payment', [
                'amount' => 1000.00,
                'paid_at' => now()->toDateString(),
            ])->json('data');

        $this->withHeaders($this->headers($admin))
            ->postJson('/api/v1/admin/contracts/'.$contract['id'].'/installments/'.$rows[1]['id'].'/payment/'.$payment['id'].'/cancel', [
                'cancel_reason' => 'خطأ في التسجيل',
            ])->assertStatus(200);

        $this->assertSame('0.00', Installment::findOrFail($rows[1]['id'])->paid_amount);

        $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/contracts/'.$contract['id'], [
                'schedule' => [
                    ['installment_id' => $rows[2]['id'], 'due_date' => $rows[2]['due_date'], 'amount' => 50000.00],
                ],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('schedule');

        $this->assertDatabaseHas('installments', ['id' => $rows[1]['id']]);
    }

    public function test_editing_a_posted_contract_moves_the_unit(): void
    {
        $admin = $this->createAdmin();
        $first = $this->createBuildingAndUnit('1', 'Unit 101');
        $second = $this->createBuildingAndUnit('2', 'Unit 201');
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $contract = $this->createContract($admin, $first['unit'], $client);

        $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/contracts/'.$contract['id'], [
                'unit_id' => $second['unit']->id,
            ])
            ->assertStatus(200);

        $this->assertSame($second['unit']->id, Contract::findOrFail($contract['id'])->unit_id);
        $this->assertSame('available', $first['unit']->fresh()->status->value);
        $this->assertSame('sold', $second['unit']->fresh()->status->value);

        // The schedule is untouched by a unit move.
        $this->assertDatabaseCount('installments', 0);
    }

    public function test_cannot_change_the_contract_type_or_edit_a_cancelled_contract(): void
    {
        $admin = $this->createAdmin();
        $data = $this->createBuildingAndUnit();
        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $contract = $this->createContract($admin, $data['unit'], $client);

        $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/contracts/'.$contract['id'], ['type' => 'rent'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('type');

        $this->assertSame('sale', Contract::findOrFail($contract['id'])->type->value);

        $this->withHeaders($this->headers($admin))
            ->postJson('/api/v1/admin/contracts/'.$contract['id'].'/cancel', [
                'cancellation_reason' => 'طلب العميل',
            ])->assertStatus(200);

        $this->withHeaders($this->headers($admin))
            ->putJson('/api/v1/admin/contracts/'.$contract['id'], ['notes' => 'بعد الإلغاء'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('contract');
    }
}
