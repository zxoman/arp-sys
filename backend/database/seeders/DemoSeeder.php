<?php

namespace Database\Seeders;

use App\Models\Building;
use App\Models\Client;
use App\Models\Contract;
use App\Models\Unit;
use App\Models\User;
use App\Services\Buildings\BuildingService;
use App\Services\Clients\ClientService;
use App\Services\Contracts\ContractService;
use App\Services\Payments\ReceiptService;
use App\Services\Reservations\ReservationPaymentService;
use App\Services\Reservations\ReservationService;
use App\Services\Units\UnitService;
use Carbon\Carbon;
use Illuminate\Database\Seeder;

/**
 * Demo content for the temporary GitHub Actions preview (`.github/workflows/demo.yml`).
 *
 * It fills an empty database with a small, realistic project — two buildings, a few units,
 * clients, one sale contract (partly collected), one lease, an open reservation and one cancelled
 * receipt — so every wired screen and report has something to show. It goes through the same
 * services the API uses, so numbers, statuses and the audit log stay consistent.
 *
 * Idempotent: it does nothing once a building exists. Never run it on a real database.
 */
class DemoSeeder extends Seeder
{
    public function run(): void
    {
        if (Building::query()->exists()) {
            $this->command?->warn('DemoSeeder: a building already exists, skipping.');

            return;
        }

        $admin = User::query()->where('username', 'admin')->firstOrFail();
        $buildings = app(BuildingService::class);
        $units = app(UnitService::class);
        $clients = app(ClientService::class);
        $contracts = app(ContractService::class);
        $receipts = app(ReceiptService::class);
        $reservations = app(ReservationService::class);
        $reservationPayments = app(ReservationPaymentService::class);

        $today = Carbon::today();
        $monthsAgo = fn (int $months, int $day = 5) => $today->copy()->startOfMonth()->subMonths($months)->day($day);

        // ── Buildings + units ────────────────────────────────────────────────
        $nile = $buildings->create([
            'name' => 'برج النيل',
            'number' => 'B-01',
            'type' => 'tower',
            'area' => 1200,
            'floors_count' => 2,
            'total_units' => 6,
            'has_basement' => false,
            'city' => 'القاهرة',
            'district' => 'المعادي',
            'activities' => ['residential'],
        ], $admin);

        $zahra = $buildings->create([
            'name' => 'عمارة الزهراء',
            'number' => 'B-02',
            'type' => 'building',
            'area' => 600,
            'floors_count' => 2,
            'total_units' => 4,
            'has_basement' => false,
            'city' => 'الجيزة',
            'district' => 'الدقي',
            'activities' => ['residential', 'commercial'],
        ], $admin);

        $makeUnit = function (Building $building, string $name, array $overrides = []) use ($units, $admin) {
            $floor = $building->floors()->orderBy('floor_number')->first();

            return $units->create(array_merge([
                'building_id' => $building->id,
                'floor_id' => $floor->id,
                'name' => $name,
                'type' => 'apartment',
                'activity' => 'residential',
                'purpose' => 'both',
                'area' => 100,
                'price_per_meter' => 8000,
                'rooms' => 3,
                'bathrooms' => 2,
                'is_sellable' => true,
            ], $overrides), $admin);
        };

        $u101 = $makeUnit($nile, '101');
        $u102 = $makeUnit($nile, '102', ['area' => 120]);
        $u103 = $makeUnit($nile, '103', ['purpose' => 'rent', 'price_per_meter' => null, 'area' => 90]);
        $makeUnit($nile, '104');
        $u201 = $makeUnit($zahra, '201', ['type' => 'shop', 'activity' => 'commercial', 'area' => 60, 'price_per_meter' => 12000]);
        $makeUnit($zahra, '202', ['is_sellable' => false, 'non_sellable_reason' => 'وحدة خدمية للمبنى']);

        // ── Clients ─────────────────────────────────────────────────────────
        $makeClient = fn (string $name, string $phone) => $clients->create(['name' => $name, 'phone' => $phone], $admin);

        $ahmed = $makeClient('أحمد محمود', '01000000001');
        $sara = $makeClient('سارة علي', '01000000002');
        $mona = $makeClient('منى حسن', '01000000003');
        $khaled = $makeClient('خالد إبراهيم', '01000000004');

        // ── A sale contract, half collected ──────────────────────────────────
        $sale = $contracts->create([
            'type' => 'sale',
            'status' => 'active',
            'client_id' => $ahmed->id,
            'unit_id' => $u101->id,
            'contract_date' => $monthsAgo(4, 1)->toDateString(),
            'total_price' => 800000,
            'agreed_down_payment' => 200000,
            'schedule' => [
                ['due_date' => $monthsAgo(3, 1)->toDateString(), 'amount' => 150000],
                ['due_date' => $monthsAgo(1, 1)->toDateString(), 'amount' => 150000],
                ['due_date' => $today->copy()->addMonth()->day(1)->toDateString(), 'amount' => 150000],
                ['due_date' => $today->copy()->addMonths(2)->day(1)->toDateString(), 'amount' => 150000],
            ],
        ], $admin);

        $saleRows = $sale->installments()->orderBy('sequence_number')->get();

        // Down payment + first installment, spread over two months so the revenue chart has history.
        $receipts->create([
            'contract_id' => $sale->id,
            'paid_at' => $monthsAgo(4, 3)->toDateString(),
            'payment_method' => 'bank_transfer',
            'reference' => 'TRX-1001',
            'installments' => [],
            'down_payment' => 200000,
        ], $admin);

        $receipts->create([
            'contract_id' => $sale->id,
            'paid_at' => $monthsAgo(3, 6)->toDateString(),
            'payment_method' => 'cash',
            'installments' => [['installment_id' => $saleRows[0]->id, 'amount' => 150000]],
        ], $admin);

        // ── A lease, first month collected ───────────────────────────────────
        $lease = $contracts->create([
            'type' => 'rent',
            'status' => 'active',
            'client_id' => $sara->id,
            'unit_id' => $u103->id,
            'contract_date' => $monthsAgo(2, 1)->toDateString(),
            'monthly_rent' => 6000,
            'duration_months' => 12,
            'start_date' => $monthsAgo(2, 1)->toDateString(),
            'end_date' => $monthsAgo(2, 1)->copy()->addMonths(12)->subDay()->toDateString(),
            // The refundable deposit is the lease's upfront amount (collected like a down payment).
            'agreed_down_payment' => 12000,
            'security_deposit' => 12000,
            'advance_months' => 1,
        ], $admin);

        $leaseRows = $lease->installments()->orderBy('sequence_number')->get();

        $receipts->create([
            'contract_id' => $lease->id,
            'paid_at' => $monthsAgo(2, 2)->toDateString(),
            'payment_method' => 'instapay',
            'installments' => [['installment_id' => $leaseRows[0]->id, 'amount' => (float) $leaseRows[0]->amount]],
            'down_payment' => 12000,
        ], $admin);

        // ── A second sale in the other building, only the down payment ───────
        $sale2 = $contracts->create([
            'type' => 'sale',
            'status' => 'active',
            'client_id' => $mona->id,
            'unit_id' => $u201->id,
            'contract_date' => $monthsAgo(1, 10)->toDateString(),
            'total_price' => 720000,
            'agreed_down_payment' => 150000,
            'schedule' => [
                ['due_date' => $today->copy()->addMonth()->day(10)->toDateString(), 'amount' => 285000],
                ['due_date' => $today->copy()->addMonths(2)->day(10)->toDateString(), 'amount' => 285000],
            ],
        ], $admin);

        $receipts->create([
            'contract_id' => $sale2->id,
            'paid_at' => $monthsAgo(1, 12)->toDateString(),
            'payment_method' => 'cheque',
            'reference' => 'CHQ-2201',
            'installments' => [],
            'down_payment' => 150000,
        ], $admin);

        // ── One cancelled receipt, so «التحصيل اليومي» shows the rejected lines ─
        $bounced = $receipts->create([
            'contract_id' => $sale2->id,
            'paid_at' => $today->copy()->subDays(12)->toDateString(),
            'payment_method' => 'cheque',
            'reference' => 'CHQ-2202',
            'installments' => [['installment_id' => $sale2->installments()->orderBy('sequence_number')->first()->id, 'amount' => 25000]],
        ], $admin);
        $receipts->cancel($bounced, 'شيك مرتجع من البنك', $admin);

        // ── An open reservation with a deposit ───────────────────────────────
        $reservation = $reservations->create([
            'client_id' => $khaled->id,
            'unit_id' => $u102->id,
            'reservation_date' => $today->copy()->subDays(9)->toDateString(),
        ], $admin);

        $reservationPayments->create($reservation->id, [
            'amount' => 10000,
            'paid_at' => $today->copy()->subDays(9)->toDateString(),
            'payment_method' => 'cash',
        ], $admin);

        $this->command?->info(sprintf(
            'DemoSeeder: %d buildings, %d units, %d clients, %d active contracts, 1 open reservation.',
            Building::query()->count(),
            Unit::query()->count(),
            Client::query()->count(),
            Contract::query()->where('status', 'active')->count(),
        ));
    }
}
