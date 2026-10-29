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
 * «التحصيل اليومي»: every valid payment of the period with its receipt, contract, client, unit,
 * method and amount; cancelled lines are listed apart because they are not collected money.
 */
class DailyCollectionTest extends TestCase
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

    /** @param  list<array{installment_id: int, amount: float}>  $lines */
    private function receipt(
        Contract $contract,
        string $paidAt,
        array $lines,
        ?float $downPayment = null,
        ?string $method = null
    ): Receipt {
        $payload = [
            'contract_id' => $contract->id,
            'paid_at' => $paidAt,
            'installments' => $lines,
        ];
        if ($downPayment !== null) {
            $payload['down_payment'] = $downPayment;
        }
        if ($method !== null) {
            $payload['payment_method'] = $method;
        }

        $this->withHeaders($this->headers())
            ->postJson('/api/v1/admin/receipts', $payload)
            ->assertStatus(201);

        return Receipt::query()->orderByDesc('id')->firstOrFail();
    }

    /** A sale contract with a 20,000 down payment and two 40,000 installments. */
    private function saleContract(Unit $unit, ?Client $client = null): Contract
    {
        return $this->contract([
            'type' => 'sale',
            'client_id' => ($client ?? $this->client())->id,
            'unit_id' => $unit->id,
            'contract_date' => '2026-01-01',
            'total_price' => 100000,
            'agreed_down_payment' => 20000,
            'schedule' => [
                ['due_date' => '2026-02-01', 'amount' => 40000],
                ['due_date' => '2026-03-01', 'amount' => 40000],
            ],
        ]);
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
            ->getJson('/api/v1/admin/reports/daily-collection?'.$query)
            ->assertOk()
            ->json('data');
    }

    /** @param  list<array<string, mixed>>  $rows */
    private function keyedBy(array $rows, string $key): array
    {
        return array_column($rows, null, $key);
    }

    public function test_the_lines_carry_their_receipt_contract_client_unit_and_method(): void
    {
        $client = $this->client();
        $contract = $this->saleContract($this->unit, $client);
        $rows = $contract->installments()->orderBy('sequence_number')->get();

        $january = $this->receipt(
            $contract,
            '2026-01-05',
            [['installment_id' => $rows[0]->id, 'amount' => 10000]],
            5000,
            'cash'
        );
        $february = $this->receipt(
            $contract,
            '2026-02-05',
            [['installment_id' => $rows[1]->id, 'amount' => 40000]],
            null,
            'bank_transfer'
        );

        // A reservation deposit is real cash too, outside the receipts table.
        $reservation = Reservation::create([
            'client_id' => $client->id,
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
        $this->assertSame(58000.0, (float) $data['summary']['collected']);
        $this->assertSame(0.0, (float) $data['summary']['cancelled']);
        $this->assertSame(58000.0, (float) $data['summary']['net']);
        $this->assertSame(4, $data['summary']['lines']);
        $this->assertSame(2, $data['summary']['receipts']);
        $this->assertSame(365, $data['summary']['days']);

        $byType = $this->keyedBy($data['by_type'], 'type');
        $this->assertSame(3000.0, (float) $byType['reservation']['amount']);
        $this->assertSame(1, $byType['reservation']['lines']);
        $this->assertSame(5000.0, (float) $byType['down_payment']['amount']);
        $this->assertSame(1, $byType['down_payment']['lines']);
        $this->assertSame(50000.0, (float) $byType['installment']['amount']);
        $this->assertSame(2, $byType['installment']['lines']);

        $byMethod = $this->keyedBy($data['by_method'], 'method');
        $this->assertSame(15000.0, (float) $byMethod['cash']['amount']);
        $this->assertSame(2, $byMethod['cash']['lines']);
        $this->assertSame(40000.0, (float) $byMethod['bank_transfer']['amount']);
        // A reservation payment recorded without a method falls back to «أخرى».
        $this->assertSame(3000.0, (float) $byMethod['other']['amount']);

        $this->assertSame([
            ['date' => '2026-01-05', 'amount' => 15000, 'lines' => 2],
            ['date' => '2026-02-05', 'amount' => 40000, 'lines' => 1],
            ['date' => '2026-02-10', 'amount' => 3000, 'lines' => 1],
        ], $data['by_day']);

        // Newest first.
        $payments = $data['payments'];
        $this->assertCount(4, $payments);
        $this->assertSame('2026-02-10', $payments[0]['paid_at']);
        $this->assertSame('reservation', $payments[0]['payment_type']);

        $this->assertSame('2026-02-05', $payments[1]['paid_at']);
        $this->assertSame('installment', $payments[1]['payment_type']);
        $this->assertSame($february->number, $payments[1]['receipt_number']);
        $this->assertSame($contract->number, $payments[1]['contract_number']);
        $this->assertSame('sale', $payments[1]['contract_type']);
        $this->assertSame(2, $payments[1]['sequence_number']);
        $this->assertSame($client->name, $payments[1]['client_name']);
        $this->assertSame('101', $payments[1]['unit_name']);
        $this->assertSame($this->building->name, $payments[1]['building_name']);
        $this->assertSame('bank_transfer', $payments[1]['method']);

        // The two January lines share one receipt; one is the down payment.
        $this->assertSame('2026-01-05', $payments[2]['paid_at']);
        $this->assertSame('2026-01-05', $payments[3]['paid_at']);
        $this->assertSame($january->number, $payments[2]['receipt_number']);
        $this->assertSame($january->number, $payments[3]['receipt_number']);
        $types = [$payments[2]['payment_type'], $payments[3]['payment_type']];
        sort($types);
        $this->assertSame(['down_payment', 'installment'], $types);

        $downPayment = $payments[2]['payment_type'] === 'down_payment' ? $payments[2] : $payments[3];
        $installmentLine = $payments[2]['payment_type'] === 'installment' ? $payments[2] : $payments[3];
        $this->assertNull($downPayment['sequence_number']);
        $this->assertSame(1, $installmentLine['sequence_number']);
        $this->assertSame(10000.0, (float) $installmentLine['amount']);
        $this->assertSame(5000.0, (float) $downPayment['amount']);
    }

    public function test_a_cancelled_receipt_is_listed_apart_from_the_collection(): void
    {
        $contract = $this->saleContract($this->unit);
        $installment = $contract->installments()->orderBy('sequence_number')->firstOrFail();

        $receipt = $this->receipt(
            $contract,
            '2026-01-10',
            [['installment_id' => $installment->id, 'amount' => 20000]],
            null,
            'cheque'
        );

        $this->withHeaders($this->headers())
            ->postJson("/api/v1/admin/receipts/{$receipt->id}/cancel", ['cancel_reason' => 'شيك مرتجع'])
            ->assertOk();

        $data = $this->report();

        $this->assertSame(0.0, (float) $data['summary']['collected']);
        $this->assertSame(20000.0, (float) $data['summary']['cancelled']);
        $this->assertSame(-20000.0, (float) $data['summary']['net']);
        $this->assertSame(0, $data['summary']['lines']);
        $this->assertSame(0, $data['summary']['receipts']);
        $this->assertSame([], $data['payments']);
        $this->assertSame([], $data['by_day']);

        $this->assertCount(1, $data['cancelled_payments']);
        $cancelled = $data['cancelled_payments'][0];
        $this->assertSame('installment', $cancelled['payment_type']);
        $this->assertSame('2026-01-10', $cancelled['paid_at']);
        $this->assertSame(20000.0, (float) $cancelled['amount']);
        $this->assertSame($receipt->number, $cancelled['receipt_number']);
        $this->assertSame($contract->number, $cancelled['contract_number']);
        $this->assertSame('sale', $cancelled['contract_type']);
        $this->assertSame(1, $cancelled['sequence_number']);
        $this->assertSame('cheque', $cancelled['method']);
        $this->assertSame('شيك مرتجع', $cancelled['cancel_reason']);
    }

    public function test_the_building_and_the_period_narrow_the_lines(): void
    {
        $other = $this->makeBuilding();
        $otherUnit = $this->makeUnit($other, '201');

        foreach ([$this->unit, $otherUnit] as $unit) {
            $contract = $this->saleContract($unit);
            $installment = $contract->installments()->orderBy('sequence_number')->firstOrFail();
            $this->receipt(
                $contract,
                $unit->id === $this->unit->id ? '2026-01-15' : '2026-03-15',
                [['installment_id' => $installment->id, 'amount' => 40000]]
            );
        }

        $all = $this->report();
        $this->assertSame(80000.0, (float) $all['summary']['collected']);
        $this->assertSame(2, $all['summary']['lines']);

        $mine = $this->report(buildingId: $this->building->id);
        $this->assertSame(40000.0, (float) $mine['summary']['collected']);
        $this->assertSame(1, $mine['summary']['lines']);
        $this->assertSame($this->building->name, $mine['payments'][0]['building_name']);

        $theirs = $this->report(buildingId: $other->id);
        $this->assertSame(1, $theirs['summary']['lines']);
        $this->assertSame('201', $theirs['payments'][0]['unit_name']);

        // The period bounds the payment date, not the entry date.
        $january = $this->report('2026-01-01', '2026-01-31');
        $this->assertSame(1, $january['summary']['lines']);
        $this->assertSame(['2026-01-15'], array_column($january['by_day'], 'date'));

        $february = $this->report('2026-02-01', '2026-02-28');
        $this->assertSame(0, $february['summary']['lines']);
        $this->assertSame(0.0, (float) $february['summary']['collected']);
        $this->assertSame(28, $february['summary']['days']);
    }

    public function test_a_reservation_payment_has_no_receipt_and_no_contract(): void
    {
        $reservation = Reservation::create([
            'client_id' => $this->client()->id,
            // Building-level: no unit to name.
            'building_id' => $this->building->id,
            'unit_id' => null,
            'reservation_date' => '2026-04-01',
            'status' => 'active',
        ]);
        ReservationPayment::create([
            'reservation_id' => $reservation->id,
            'amount' => 7000,
            'paid_at' => '2026-04-02',
            'payment_method' => 'vodafone_cash',
            'status' => 'valid',
            'created_by' => $this->admin->id,
        ]);

        $data = $this->report();
        $this->assertCount(1, $data['payments']);

        $payment = $data['payments'][0];
        $this->assertSame('reservation', $payment['payment_type']);
        $this->assertNull($payment['receipt_number']);
        $this->assertNull($payment['contract_id']);
        $this->assertNull($payment['contract_number']);
        $this->assertNull($payment['contract_type']);
        $this->assertNull($payment['sequence_number']);
        $this->assertNull($payment['unit_name']);
        $this->assertSame($this->building->name, $payment['building_name']);
        $this->assertSame('vodafone_cash', $payment['method']);
        $this->assertSame(1, $data['summary']['lines']);
        $this->assertSame(0, $data['summary']['receipts']);
        $this->assertSame(7000.0, (float) $data['summary']['collected']);
    }
}
