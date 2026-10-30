<?php

namespace App\Services\Units;

use App\Models\Contract;
use App\Models\ContractDownPayment;
use App\Models\Installment;
use App\Models\InstallmentPayment;
use App\Models\Receipt;
use App\Models\Reservation;
use App\Models\ReservationPayment;
use App\Models\Unit;
use Illuminate\Support\Collection;

/**
 * Permanent deletion of everything a unit owns: its contracts with their schedule, receipts and
 * payment lines, and its reservations with their deposits. The owner (BuildingService or
 * UnitService) runs this inside a transaction and logs the removed counts.
 *
 * Order matters — a receipt blocks its contract (FK `restrictOnDelete`), so receipts go first;
 * payments, down payments and installments are removed explicitly so they can be counted, and
 * reservations before their unit (the FK is `nullOnDelete`, which would otherwise leave orphans).
 */
class UnitTreeDeleter
{
    /** Delete a single unit's contracts, reservations, payments and receipts. */
    public function deleteUnit(Unit $unit): array
    {
        $contractIds = Contract::withTrashed()->where('unit_id', $unit->id)->pluck('id');
        $reservationIds = Reservation::withTrashed()->where('unit_id', $unit->id)->pluck('id');

        return $this->deleteContracts($contractIds) + $this->deleteReservations($reservationIds);
    }

    /**
     * Delete the contracts (with their money) of the given ids.
     *
     * @param  Collection<int, int>  $contractIds
     * @return array{contracts: int, installments: int, receipts: int, payments: int}
     */
    public function deleteContracts(Collection $contractIds): array
    {
        $counts = ['contracts' => 0, 'installments' => 0, 'receipts' => 0, 'payments' => 0];

        if ($contractIds->isEmpty()) {
            return $counts;
        }

        $receipts = Receipt::withTrashed()->whereIn('contract_id', $contractIds);
        $counts['receipts'] = $receipts->count();
        $receipts->forceDelete();

        $downPayments = ContractDownPayment::withTrashed()->whereIn('contract_id', $contractIds);
        $installmentPayments = InstallmentPayment::withTrashed()->whereIn('contract_id', $contractIds);
        $counts['payments'] = $downPayments->count() + $installmentPayments->count();
        $downPayments->forceDelete();
        $installmentPayments->forceDelete();

        $installments = Installment::whereIn('contract_id', $contractIds);
        $counts['installments'] = $installments->count();
        $installments->delete();

        $contracts = Contract::withTrashed()->whereIn('id', $contractIds);
        $counts['contracts'] = $contracts->count();
        $contracts->forceDelete();

        return $counts;
    }

    /**
     * Delete the reservations (with their deposits) of the given ids.
     *
     * @param  Collection<int, int>  $reservationIds
     * @return array{reservations: int, deposit_payments: int}
     */
    public function deleteReservations(Collection $reservationIds): array
    {
        $counts = ['reservations' => 0, 'deposit_payments' => 0];

        if ($reservationIds->isEmpty()) {
            return $counts;
        }

        $payments = ReservationPayment::withTrashed()->whereIn('reservation_id', $reservationIds);
        $counts['deposit_payments'] = $payments->count();
        $payments->forceDelete();

        $reservations = Reservation::withTrashed()->whereIn('id', $reservationIds);
        $counts['reservations'] = $reservations->count();
        $reservations->forceDelete();

        return $counts;
    }
}
