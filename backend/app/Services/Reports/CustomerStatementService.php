<?php

namespace App\Services\Reports;

use App\Models\Client;
use App\Models\Contract;
use App\Models\Reservation;

class CustomerStatementService extends BaseReportService
{
    public function generate(int $clientId, string $fromDate, string $toDate): array
    {
        $client = Client::findOrFail($clientId);

        // Reservations
        $reservations = Reservation::where('client_id', $clientId)
            ->whereBetween('reservation_date', [$fromDate, $toDate])
            ->with('building', 'unit')
            ->orderBy('reservation_date')
            ->get();

        // Contracts
        $contracts = Contract::where('client_id', $clientId)
            ->whereBetween('contract_date', [$fromDate, $toDate])
            ->with('unit', 'installments')
            ->orderBy('contract_date')
            ->get();

        // All payments for this client (the filters are applied inside every union branch).
        $payments = $this->paymentsQuery($fromDate, $toDate, ['client_id' => $clientId])->get();

        $cancelledPayments = $this->cancelledPaymentsQuery($fromDate, $toDate, ['client_id' => $clientId])->get();

        // Build reservation data
        $reservationData = [];
        $totalReservationsPaid = 0;

        foreach ($reservations as $r) {
            // A reservation carries no agreed price, so only what was actually paid is reported;
            // the price is agreed when the reservation is converted to a contract.
            $depositPaid = (float) $r->deposit_paid;
            $totalReservationsPaid += $depositPaid;

            $reservationData[] = [
                'id' => $r->id,
                'reservation_date' => $r->reservation_date,
                'building' => $r->building?->name,
                'unit' => $r->unit?->name,
                'unit_type' => $r->unit_type,
                'unit_activity' => $r->unit_activity,
                'deposit_paid' => $this->money($depositPaid),
                'status' => $r->status?->value,
                'is_cancelled' => $r->status === 'cancelled',
            ];
        }

        // Build contract data
        $contractData = [];
        $totalContractsValue = 0;
        $totalContractsDownPayment = 0;
        $totalContractsPaid = 0;
        $totalContractsRemaining = 0;
        $totalContractsOverdue = 0;

        foreach ($contracts as $c) {
            $downPaymentAgreed = (float) $c->agreed_down_payment;
            $downPaymentPaid = (float) $c->paid_down_payment;
            $downPaymentRemaining = (float) $c->remaining_down_payment;
            $totalPrice = (float) $c->total_price;
            $collected = (float) $c->total_collected;

            $totalContractsValue += $totalPrice;
            $totalContractsDownPayment += $downPaymentAgreed;
            $totalContractsPaid += $downPaymentPaid + ($c->total_collected - $downPaymentPaid);
            $totalContractsRemaining += $totalPrice - $collected;

            // Installments
            $installmentData = [];
            $installmentTotalRequired = 0;
            $installmentTotalPaid = 0;
            $installmentTotalRemaining = 0;
            $installmentOverdueTotal = 0;

            foreach ($c->installments as $inst) {
                $amount = (float) $inst->amount;
                $paid = (float) $inst->paid_amount;
                $remaining = (float) $inst->remaining;
                $isOverdue = $inst->isOverdue();

                $installmentTotalRequired += $amount;
                $installmentTotalPaid += $paid;
                $installmentTotalRemaining += $remaining;
                if ($isOverdue) {
                    $installmentOverdueTotal += $remaining;
                }

                $installmentData[] = [
                    'id' => $inst->id,
                    'sequence_number' => $inst->sequence_number,
                    'due_date' => $inst->due_date,
                    'amount' => $this->money($amount),
                    'paid_amount' => $this->money($paid),
                    'remaining' => $this->money($remaining),
                    'status' => $inst->status?->value,
                    'is_overdue' => $isOverdue,
                ];
            }

            // Counted after the loop above so the partial/overdue rows of THIS contract are included.
            $totalContractsOverdue += $installmentOverdueTotal;

            $contractData[] = [
                'id' => $c->id,
                'number' => $c->number,
                'type' => $c->type?->value,
                'contract_date' => $c->contract_date,
                'unit' => $c->unit?->name,
                'total_price' => $this->money($totalPrice),
                'agreed_down_payment' => $this->money($downPaymentAgreed),
                'down_payment_paid' => $this->money($downPaymentPaid),
                'down_payment_remaining' => $this->money($downPaymentRemaining),
                'total_collected' => $this->money($collected),
                'total_remaining' => $this->money($totalPrice - $collected),
                'status' => $c->status?->value,
                'is_cancelled' => $c->status === 'cancelled',
                'installments' => $installmentData,
                'installment_totals' => [
                    'required' => $this->money($installmentTotalRequired),
                    'paid' => $this->money($installmentTotalPaid),
                    'remaining' => $this->money($installmentTotalRemaining),
                    'overdue' => $this->money($installmentOverdueTotal),
                ],
            ];
        }

        // Build payment list (chronological)
        $paymentList = [];
        $totalPaymentsValid = 0;
        $totalPaymentsCancelled = 0;

        foreach ($payments as $p) {
            $amount = (float) $p->amount;
            $totalPaymentsValid += $amount;

            $paymentList[] = [
                'id' => $p->id,
                'paid_at' => $p->paid_at,
                'payment_type' => $p->payment_type,
                'entity_id' => $p->entity_id,
                'amount' => $this->money($amount),
                'payment_method' => $p->payment_method,
                'status' => $p->status,
                'client_name' => $client->name,
                'contract_id' => $p->contract_id === null ? null : (int) $p->contract_id,
                'contract_number' => $p->contract_number,
            ];
        }

        foreach ($cancelledPayments as $p) {
            $amount = (float) $p->amount;
            $totalPaymentsCancelled += $amount;

            $paymentList[] = [
                'id' => $p->id,
                'paid_at' => $p->cancelled_at ?? $p->paid_at,
                'payment_type' => $p->payment_type,
                'entity_id' => $p->entity_id,
                'amount' => $this->money($amount),
                'payment_method' => $p->payment_method,
                'status' => 'cancelled',
                'cancel_reason' => $p->cancel_reason,
                'client_name' => $client->name,
                'contract_id' => $p->contract_id === null ? null : (int) $p->contract_id,
                'contract_number' => $p->contract_number,
                'is_cancelled' => true,
            ];
        }

        usort($paymentList, fn ($a, $b) => strtotime($a['paid_at']) - strtotime($b['paid_at']));

        // Totals
        $grandTotalRequired = $totalContractsValue;
        $grandTotalPaid = $totalReservationsPaid + $totalContractsPaid;
        $grandTotalRemaining = $totalContractsRemaining;
        // Overdue is the unpaid remainder of the rows that are past their due date, not the whole contract remainder.
        $grandTotalOverdue = $totalContractsOverdue;

        $this->logReportAccess('customer_statement', [
            'client_id' => $clientId,
            'from_date' => $fromDate,
            'to_date' => $toDate,
        ]);

        return [
            'client' => [
                'id' => $client->id,
                'name' => $client->name,
                'phone' => $client->phone,
            ],
            'period' => [
                'from' => $fromDate,
                'to' => $toDate,
            ],
            'reservations' => $reservationData,
            'contracts' => $contractData,
            'payments' => $paymentList,
            'totals' => [
                'required' => $this->money($grandTotalRequired),
                'paid' => $this->money($grandTotalPaid),
                'remaining' => $this->money($grandTotalRemaining),
                'overdue' => $this->money($grandTotalOverdue),
                'cancelled_payments' => $this->money($totalPaymentsCancelled),
            ],
            'reservation_totals' => [
                'paid' => $this->money($totalReservationsPaid),
            ],
            'contract_totals' => [
                'value' => $this->money($totalContractsValue),
                'down_payment_agreed' => $this->money($totalContractsDownPayment),
                'paid' => $this->money($totalContractsPaid),
                'remaining' => $this->money($totalContractsRemaining),
            ],
        ];
    }
}
