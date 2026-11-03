<?php

namespace Tests\Feature;

use App\Models\Building;
use App\Models\BuildingActivity;
use App\Models\Client;
use App\Models\Contract;
use App\Models\Floor;
use App\Models\InstallmentPayment;
use App\Models\Receipt;
use App\Models\Role;
use App\Models\RolePermission;
use App\Models\Unit;
use App\Models\User;
use Tests\TestCase;

/**
 * Receipts (إيصالات القبض): the collection page pays one or more installments — and optionally part
 * of the down payment — with one numbered receipt, and cancels it as a whole.
 */
class ReceiptTest extends TestCase
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

    /** An active contract with three 10,000 installments and a 30,000 down payment. */
    private function contract(): Contract
    {
        $client = Client::create(['name' => 'Client ' . ++self::$sequence, 'phone' => '+201000000' . random_int(100, 999)]);

        $id = $this->withHeaders($this->headers())->postJson('/api/v1/admin/contracts', [
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $this->unit()->id,
            'contract_date' => '2026-01-10',
            'total_price' => 60000,
            'agreed_down_payment' => 30000,
            'schedule' => [
                ['due_date' => '2026-02-01', 'amount' => 10000],
                ['due_date' => '2026-03-01', 'amount' => 10000],
                ['due_date' => '2026-04-01', 'amount' => 10000],
            ],
        ])->assertStatus(201)->json('data.id');

        return Contract::findOrFail($id);
    }

    /** Owner rule 2026-11-03: paying several installments issues one receipt per installment. */
    public function test_each_installment_gets_its_own_receipt(): void
    {
        $contract = $this->contract();
        [$first, $second] = $contract->installments()->orderBy('sequence_number')->limit(2)->get()->all();

        $response = $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'payment_method' => 'instapay',
            'reference' => 'TRX-99881',
            'notes' => 'دفعة أولى',
            'installments' => [
                ['installment_id' => $first->id, 'amount' => 10000],
                ['installment_id' => $second->id, 'amount' => 4000],
            ],
            'down_payment' => 20000,
        ]);

        $response->assertStatus(201);

        // Two installments + the down payment = three separate, consecutively numbered receipts.
        $response->assertJsonPath('meta.count', 3);
        $this->assertDatabaseCount('receipts', 3);

        $numbers = collect($response->json('meta.receipts'))->pluck('number')->all();
        $this->assertCount(3, $numbers);
        $this->assertSame($numbers, array_values(array_unique($numbers)));
        foreach ($numbers as $number) {
            $this->assertMatchesRegularExpression('/^R-2026-\d{5}$/', $number);
        }

        // Each receipt holds exactly one line: the first installment, the second, then the deposit.
        $receipts = Receipt::orderBy('number')->get();
        $this->assertSame(['10000.00', '4000.00', '20000.00'], $receipts->pluck('total_amount')->all());

        foreach ($receipts as $receipt) {
            $this->assertLessThanOrEqual(1, $receipt->installmentPayments()->count());
            $this->assertLessThanOrEqual(1, $receipt->downPayments()->count());
        }

        $this->assertSame(
            [$first->id, $second->id],
            InstallmentPayment::whereNotNull('receipt_id')->orderBy('id')->pluck('installment_id')->all()
        );

        // The money still lands where it should, and every line carries its own receipt number.
        $this->assertSame('paid', $first->fresh()->status->value);
        $this->assertSame('10000.00', $first->fresh()->paid_amount);
        $this->assertSame('partially_paid', $second->fresh()->status->value);
        $this->assertSame('6000.00', $second->fresh()->remaining);

        $contract = $contract->fresh();
        $this->assertSame('20000.00', $contract->paid_down_payment);
        $this->assertSame('10000.00', $contract->remaining_down_payment);

        $this->assertDatabaseHas('installment_payments', [
            'installment_id' => $first->id,
            'receipt_id' => $receipts[0]->id,
            'payment_method' => 'instapay',
        ]);
        $this->assertDatabaseHas('installment_payments', [
            'installment_id' => $second->id,
            'receipt_id' => $receipts[1]->id,
            'payment_method' => 'instapay',
        ]);
        $this->assertDatabaseHas('contract_down_payments', [
            'receipt_id' => $receipts[2]->id,
            'amount' => '20000.00',
        ]);
    }

    /** A single installment still produces exactly one receipt, returned in `data`. */
    public function test_a_single_installment_makes_one_receipt(): void
    {
        $contract = $this->contract();
        $installment = $contract->installments()->orderBy('sequence_number')->first();

        $response = $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'installments' => [['installment_id' => $installment->id, 'amount' => 10000]],
        ]);

        $response->assertStatus(201);
        $response->assertJsonPath('meta.count', 1);
        $response->assertJsonPath('data.total_amount', '10000.00');
        $this->assertSame($response->json('data.id'), $response->json('meta.receipts.0.id'));
        $this->assertDatabaseCount('receipts', 1);
    }

    public function test_a_receipt_may_not_pay_more_than_an_installment_owes(): void
    {
        $contract = $this->contract();
        $installment = $contract->installments()->orderBy('sequence_number')->first();

        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'installments' => [['installment_id' => $installment->id, 'amount' => 25000]],
        ])->assertStatus(422)->assertJsonPath('errors.amount.0', __('installments.payment_exceeds_remaining'));

        $this->assertDatabaseCount('receipts', 0);
        $this->assertDatabaseCount('installment_payments', 0);
        $this->assertSame('10000.00', $installment->fresh()->remaining);
    }

    public function test_a_receipt_may_not_exceed_the_remaining_down_payment(): void
    {
        $contract = $this->contract();

        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'down_payment' => 40000,
        ])->assertStatus(422)->assertJsonPath('errors.down_payment.0', __('receipts.down_payment_exceeds_remaining'));

        $this->assertDatabaseCount('receipts', 0);
    }

    public function test_a_receipt_needs_at_least_one_line(): void
    {
        $contract = $this->contract();

        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
        ])->assertStatus(422)->assertJsonPath('errors.installments.0', __('receipts.empty'));
    }

    public function test_the_same_installment_cannot_be_listed_twice(): void
    {
        $contract = $this->contract();
        $installment = $contract->installments()->orderBy('sequence_number')->first();

        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'installments' => [
                ['installment_id' => $installment->id, 'amount' => 2500],
                ['installment_id' => $installment->id, 'amount' => 2500],
            ],
        ])->assertStatus(422);

        $this->assertDatabaseCount('receipts', 0);
    }

    public function test_a_draft_or_cancelled_contract_collects_nothing(): void
    {
        $contract = $this->contract();
        $contract->update(['status' => 'cancelled', 'cancelled_at' => now()]);

        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'down_payment' => 1000,
        ])->assertStatus(422)->assertJsonPath('errors.contract_id.0', __('receipts.contract_not_active'));

        $this->assertDatabaseCount('receipts', 0);
    }

    /** With one receipt per installment, cancelling one returns only its own installment. */
    public function test_cancelling_a_receipt_reverses_only_its_own_line(): void
    {
        $contract = $this->contract();
        [$first, $second] = $contract->installments()->orderBy('sequence_number')->limit(2)->get()->all();

        $created = $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'installments' => [
                ['installment_id' => $first->id, 'amount' => 10000],
                ['installment_id' => $second->id, 'amount' => 5000],
            ],
            'down_payment' => 10000,
        ])->assertStatus(201)->json('meta.receipts');

        [$firstReceipt, $secondReceipt, $depositReceipt] = $created;
        $this->assertSame('10000.00', $firstReceipt['total_amount']);
        $this->assertSame('5000.00', $secondReceipt['total_amount']);
        $this->assertSame('10000.00', $depositReceipt['total_amount']);

        // Cancel the receipt of the first installment only.
        $this->withHeaders($this->headers())->postJson("/api/v1/admin/receipts/{$firstReceipt['id']}/cancel", [
            'cancel_reason' => 'شيك مرتجع',
        ])->assertStatus(200)->assertJsonPath('data.status', 'cancelled');

        $this->assertSame('due', $first->fresh()->status->value);
        $this->assertSame('0.00', $first->fresh()->paid_amount);

        // The other two receipts and their money are untouched.
        $this->assertSame('5000.00', $second->fresh()->paid_amount);
        $this->assertSame('10000.00', $contract->fresh()->paid_down_payment);
        $this->assertDatabaseHas('receipts', ['id' => $secondReceipt['id'], 'status' => 'valid']);
        $this->assertDatabaseHas('receipts', ['id' => $depositReceipt['id'], 'status' => 'valid']);

        $this->assertDatabaseHas('installment_payments', ['receipt_id' => $firstReceipt['id'], 'status' => 'cancelled']);
        $this->assertDatabaseHas('contract_down_payments', ['receipt_id' => $depositReceipt['id'], 'status' => 'valid']);

        // Cancelling twice is refused.
        $this->withHeaders($this->headers())->postJson("/api/v1/admin/receipts/{$firstReceipt['id']}/cancel", [
            'cancel_reason' => 'مرة أخرى',
        ])->assertStatus(422);
    }

    public function test_receipts_index_searches_and_pages(): void
    {
        $contract = $this->contract();
        $installment = $contract->installments()->orderBy('sequence_number')->first();

        $this->withHeaders($this->headers())->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'installments' => [['installment_id' => $installment->id, 'amount' => 1000]],
        ])->assertStatus(201);

        $list = $this->withHeaders($this->headers())->getJson('/api/v1/admin/receipts?search=' . $contract->number);
        $list->assertStatus(200);
        $list->assertJsonCount(1, 'data');
        $list->assertJsonPath('data.0.contract_number', $contract->number);
        $list->assertJsonPath('data.0.client_name', $contract->client->name);

        // Searching by the receipt number itself works too.
        $number = $list->json('data.0.number');
        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/receipts?search=' . $number)
            ->assertStatus(200)
            ->assertJsonCount(1, 'data');

        $this->withHeaders($this->headers())
            ->getJson('/api/v1/admin/receipts?search=لا-يوجد-إيصال')
            ->assertStatus(200)
            ->assertJsonCount(0, 'data');
    }

    public function test_receipts_require_the_payment_permissions(): void
    {
        $contract = $this->contract();
        $installment = $contract->installments()->orderBy('sequence_number')->first();

        $role = Role::create(['name' => 'viewer', 'is_admin' => false]);
        RolePermission::create(['role_id' => $role->id, 'permission' => 'contracts.view']);
        $viewer = User::create([
            'name' => 'Viewer',
            'username' => 'viewer',
            'password' => bcrypt('password123'),
            'role_id' => $role->id,
            'status' => 'active',
            'lock_version' => 0,
        ]);
        $this->assertFalse($viewer->fresh()->hasPermission('payments.create'), 'viewer must not have payments.create');

        // actingAs: the sanctum guard keeps the first user of the test once a token authenticated it.
        $this->actingAs($viewer, 'sanctum');

        $this->getJson('/api/v1/admin/receipts')->assertStatus(200);

        $this->postJson('/api/v1/admin/receipts', [
            'contract_id' => $contract->id,
            'paid_at' => '2026-02-05',
            'installments' => [['installment_id' => $installment->id, 'amount' => 1000]],
        ])->assertStatus(403);
    }
}
