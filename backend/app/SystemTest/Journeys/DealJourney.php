<?php

namespace App\SystemTest\Journeys;

use App\SystemTest\Journey;
use App\SystemTest\JourneyResult;

/**
 * The money path end to end: client → reservation + deposit → contract → receipt → installment
 * payment → cancel (the «مرتجع») → reports → client cascade delete.
 */
class DealJourney extends Journey
{
    public function __construct()
    {
        parent::__construct('Clients, deals & money');
    }

    public function run(): JourneyResult
    {
        if (! $this->login()) {
            return $this->result;
        }

        $building = $this->post('/api/v1/admin/buildings', [
            'name' => 'برج التعاملات',
            'city' => 'الجيزة',
            'district' => 'الدقي',
            'type' => 'building',
            'activities' => ['residential'],
            'floors_count' => 1,
            'total_units' => 2,
        ]);
        if (! $this->expect($building, 201, 'create building')) {
            return $this->result;
        }
        $buildingId = (int) data_get($building['json'], 'data.id');

        $detail = $this->get("/api/v1/admin/buildings/{$buildingId}");
        $floorId = (int) data_get($detail['json'], 'data.floors.0.id');

        $makeUnit = function (string $name) use ($buildingId, $floorId): int {
            $response = $this->post('/api/v1/admin/units', [
                'building_id' => $buildingId,
                'floor_id' => $floorId,
                'name' => $name,
                'type' => 'apartment',
                'activity' => 'residential',
                'area' => 100,
                'price_per_meter' => 10000,
            ]);

            return (int) data_get($response['json'], 'data.id');
        };

        $saleUnit = $makeUnit('201');
        $rentUnit = $makeUnit('202');

        // --- Client (phones are normalised server-side) -------------------------------
        $client = $this->post('/api/v1/admin/clients', [
            'name' => 'عميل الاختبار',
            'phone' => '01012345678',
            'phone_2' => '٠١٠٩٨٧٦٥٤٣٢',
        ]);
        if (! $this->expect($client, 201, 'create client')) {
            return $this->result;
        }
        $clientId = (int) data_get($client['json'], 'data.id');
        $this->expect($client, 201, 'phone is normalised', 'data.phone', '+201012345678');
        $this->expect($client, 201, 'second phone is normalised', 'data.phone_2', '+201098765432');

        // --- Reservation with a deposit ----------------------------------------------
        $reservation = $this->post('/api/v1/admin/reservations', [
            'client_id' => $clientId,
            'unit_id' => $saleUnit,
            'reservation_date' => now()->toDateString(),
            'first_payment' => ['amount' => 5000, 'paid_at' => now()->toDateString(), 'payment_method' => 'cash'],
        ]);
        if (! $this->expect($reservation, 201, 'create reservation with a deposit')) {
            return $this->result;
        }
        $reservationId = (int) data_get($reservation['json'], 'data.id');
        $this->assert((float) data_get($reservation['json'], 'data.deposit_paid'), 5000.0, 'deposit counted on the reservation');

        $this->expect($this->get("/api/v1/admin/units/{$saleUnit}"), 200, 'reserved unit is locked', 'data.status', 'reserved');

        // --- Sale contract from the reservation --------------------------------------
        $contract = $this->post('/api/v1/admin/contracts', [
            'type' => 'sale',
            'reservation_id' => $reservationId,
            'client_id' => $clientId,
            'unit_id' => $saleUnit,
            'contract_date' => now()->toDateString(),
            'total_price' => 1000000,
            'agreed_down_payment' => 200000,
            'installments_count' => 2,
            'first_installment_date' => now()->addMonth()->toDateString(),
            'interval_months' => 1,
        ]);
        if (! $this->expect($contract, 201, 'create sale contract')) {
            return $this->result;
        }
        $contractId = (int) data_get($contract['json'], 'data.id');

        $this->expect($this->get("/api/v1/admin/units/{$saleUnit}"), 200, 'sold unit is marked sold', 'data.status', 'sold');
        $this->expect($this->get("/api/v1/admin/reservations/{$reservationId}"), 200, 'reservation is converted', 'data.status', 'converted');

        // --- Receipt covering the remaining down payment -----------------------------
        $receipt = $this->post('/api/v1/admin/receipts', [
            'contract_id' => $contractId,
            'paid_at' => now()->toDateString(),
            'payment_method' => 'cash',
            'down_payment' => 195000,
        ]);
        $this->expect($receipt, 201, 'collect the rest of the down payment');

        $shown = $this->get("/api/v1/admin/contracts/{$contractId}");
        $this->expect($shown, 200, 'contract detail loads');
        $this->assert((float) data_get($shown['json'], 'data.paid_down_payment'), 200000.0, 'down payment fully paid (deposit included)');
        $this->assert((float) data_get($shown['json'], 'data.remaining_down_payment'), 0.0, 'nothing left of the down payment');

        // --- Paying an installment ---------------------------------------------------
        $installmentId = (int) data_get($shown['json'], 'data.installments.0.id');
        $payment = $this->post("/api/v1/admin/contracts/{$contractId}/installments/{$installmentId}/payment", [
            'amount' => 100000,
            'paid_at' => now()->toDateString(),
            'payment_method' => 'cash',
        ]);
        $this->expect($payment, 201, 'record an installment payment');

        // --- Lease contract on the second unit ---------------------------------------
        $lease = $this->post('/api/v1/admin/contracts', [
            'type' => 'rent',
            'client_id' => $clientId,
            'unit_id' => $rentUnit,
            'contract_date' => now()->toDateString(),
            'monthly_rent' => 10000,
            'duration_months' => 12,
            'start_date' => now()->toDateString(),
            'security_deposit' => 20000,
        ]);
        $this->expect($lease, 201, 'create lease contract');
        $this->expect($this->get("/api/v1/admin/units/{$rentUnit}"), 200, 'leased unit is marked rented', 'data.status', 'rented');

        // --- Cancel (the «مرتجع» screen) ---------------------------------------------
        $cancelled = $this->post("/api/v1/admin/contracts/{$contractId}/cancel", [
            'cancellation_reason' => 'اختبار النظام',
        ]);
        $this->expect($cancelled, 200, 'cancel a contract', 'data.status', 'cancelled');
        $this->expect($this->get("/api/v1/admin/units/{$saleUnit}"), 200, 'cancelled contract frees the unit', 'data.status', 'available');

        // The returns screen reads exactly this: cancelled contracts.
        $returns = $this->get('/api/v1/admin/contracts?status=cancelled');
        $this->expect($returns, 200, 'cancelled contracts are listed for the returns screen', 'meta.total', 1);
        $this->assert(data_get($returns['json'], 'data.0.id'), $contractId, 'the returns list holds the contract just cancelled');

        // --- Reports that read the same data -----------------------------------------
        $today = now()->toDateString();
        $this->expect($this->get("/api/v1/admin/reports/installments-summary?building_id={$buildingId}"), 200, 'installments summary report');
        $this->expect($this->get("/api/v1/admin/reports/due-overdue?building_id={$buildingId}"), 200, 'due & overdue report');
        $from = now()->subMonths(11)->startOfMonth()->toDateString();
        $this->expect($this->get("/api/v1/admin/reports/monthly-revenue?from_date={$from}&to_date={$today}"), 200, 'monthly revenue report');
        $this->expect($this->get('/api/v1/admin/reports/daily-collection?from_date='.now()->subDays(30)->toDateString()."&to_date={$today}"), 200, 'daily collection report');
        $this->expect($this->get("/api/v1/admin/reports/unit-status?building_id={$buildingId}"), 200, 'unit status report');
        $this->expect($this->get("/api/v1/admin/reports/building-statement?building_id={$buildingId}&from_date={$from}&to_date={$today}"), 200, 'building statement report');
        $this->expect($this->get("/api/v1/admin/reports/customer-statement?client_id={$clientId}&from_date={$from}&to_date={$today}"), 200, 'customer statement report');
        $this->expect($this->get("/api/v1/admin/reports/unit-statement?unit_id={$rentUnit}&from_date={$from}&to_date={$today}"), 200, 'unit statement report');

        // --- Permanent client cascade ------------------------------------------------
        $deleted = $this->delete("/api/v1/admin/clients/{$clientId}");
        $this->expect($deleted, 200, 'delete the client with everything they own');
        $this->assert(data_get($deleted['json'], 'data.deleted.contracts'), 2, 'both contracts removed with the client');
        $this->expect($this->get("/api/v1/admin/clients/{$clientId}"), 404, 'the client is gone');
        $this->expect($this->get("/api/v1/admin/units/{$rentUnit}"), 200, 'their leased unit is free again', 'data.status', 'available');

        $this->expect($this->delete("/api/v1/admin/buildings/{$buildingId}"), 200, 'delete the test building');

        return $this->result;
    }
}
