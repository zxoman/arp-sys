<?php

namespace App\Services\Payments;

use App\Enums\PaymentMethod;
use App\Enums\PaymentStatus;
use App\Models\Contract;
use App\Models\ContractDownPayment;
use App\Models\Installment;
use App\Models\InstallmentPayment;
use App\Models\Receipt;
use App\Services\Contracts\InstallmentService;
use App\Support\Transactions\Operation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Receipts (إيصالات القبض): one numbered collection act covering several installment payments
 * and, optionally, part of the contract's down payment.
 *
 * The rules are the payment rules, not new ones: no line may exceed what is still owed on its
 * installment (or on the down payment), amounts are never edited, and nothing is deleted — a
 * cancelled receipt leaves its payments in place, marked cancelled.
 */
class ReceiptService
{
    public function __construct(
        private InstallmentService $installments,
        private Operation $operation,
        private \App\Services\Audit\AuditLogger $audit
    ) {}

    /**
     * @param  array{contract_id:int, paid_at:string, payment_method?:?string, reference?:?string, notes?:?string, installments?:array<int,array{installment_id:int, amount:numeric}>, down_payment?:numeric|null}  $data
     */
    public function create(array $data, $actor): Receipt
    {
        return DB::transaction(function () use ($data, $actor) {
            $contract = Contract::whereKey($data['contract_id'])->lockForUpdate()->firstOrFail();

            if (!$contract->isActive()) {
                throw ValidationException::withMessages([
                    'contract_id' => __('receipts.contract_not_active'),
                ]);
            }

            $lines = $data['installments'] ?? [];
            $downPayment = (float) ($data['down_payment'] ?? 0);

            if (!$lines && $downPayment <= 0) {
                throw ValidationException::withMessages([
                    'installments' => __('receipts.empty'),
                ]);
            }

            $receipt = Receipt::create([
                'number' => $this->generateNumber($data['paid_at']),
                'contract_id' => $contract->id,
                'paid_at' => $data['paid_at'],
                'payment_method' => $data['payment_method'] ?? null,
                'reference' => $data['reference'] ?? null,
                'notes' => $data['notes'] ?? null,
                'total_amount' => 0,
                'status' => PaymentStatus::VALID->value,
                'created_by' => $actor->id,
            ]);

            $total = 0.0;

            foreach ($lines as $line) {
                $payment = $this->installments->recordPayment(
                    $contract->id,
                    (int) $line['installment_id'],
                    [
                        'amount' => $line['amount'],
                        'paid_at' => $data['paid_at'],
                        'payment_method' => $data['payment_method'] ?? null,
                        'notes' => $data['notes'] ?? null,
                    ],
                    $actor,
                    $receipt->id
                );
                $total += (float) $payment->amount;
            }

            if ($downPayment > 0) {
                $total += $this->recordDownPayment($contract, $downPayment, $data, $receipt, $actor);
            }

            $receipt->update(['total_amount' => round($total, 2)]);

            $this->audit->log(
                action: 'create',
                entityType: 'receipts',
                entityId: $receipt->id,
                newValues: [
                    'number' => $receipt->number,
                    'contract_id' => $contract->id,
                    'total_amount' => round($total, 2),
                    'installments' => array_map(fn ($l) => (int) $l['installment_id'], $lines),
                    'down_payment' => $downPayment > 0 ? $downPayment : null,
                ],
                isAutomatic: true,
                reason: 'Receipt #' . $receipt->number . ' recorded for contract #' . $contract->number,
            );

            return $receipt->fresh()->load('contract.client', 'contract.unit.building', 'installmentPayments.installment', 'downPayments');
        });
    }

    /**
     * Cancel the whole receipt: every payment line it created is cancelled, so the installments
     * go back to what they were. Nothing is deleted.
     */
    public function cancel(Receipt $receipt, string $reason, $actor): Receipt
    {
        if (!$receipt->isValid()) {
            throw ValidationException::withMessages([
                'receipt' => __('receipts.already_cancelled'),
            ]);
        }

        return DB::transaction(function () use ($receipt, $reason, $actor) {
            $payments = $receipt->installmentPayments()
                ->where('status', PaymentStatus::VALID->value)
                ->whereNull('deleted_at')
                ->get();

            foreach ($payments as $payment) {
                $this->installments->cancelPayment($payment, $reason, $actor);
            }

            $downPayments = $receipt->downPayments()
                ->where('status', PaymentStatus::VALID->value)
                ->whereNull('deleted_at')
                ->get();

            foreach ($downPayments as $downPayment) {
                $downPayment->update([
                    'status' => PaymentStatus::CANCELLED->value,
                    'cancel_reason' => $reason,
                    'cancelled_at' => $this->operation->now(),
                ]);

                $this->audit->log(
                    action: 'cancel',
                    entityType: 'contract_down_payments',
                    entityId: $downPayment->id,
                    oldValues: ['status' => 'valid', 'amount' => $downPayment->amount],
                    newValues: ['status' => 'cancelled', 'cancel_reason' => $reason],
                    changedFields: ['status', 'cancel_reason', 'cancelled_at'],
                    reason: 'Down-payment cancelled with receipt #' . $receipt->number . ': ' . $reason,
                );
            }

            $receipt->update([
                'status' => PaymentStatus::CANCELLED->value,
                'cancel_reason' => $reason,
                'cancelled_at' => $this->operation->now(),
            ]);

            $this->audit->log(
                action: 'cancel',
                entityType: 'receipts',
                entityId: $receipt->id,
                oldValues: ['status' => 'valid'],
                newValues: ['status' => 'cancelled', 'cancel_reason' => $reason],
                changedFields: ['status', 'cancel_reason', 'cancelled_at'],
                isAutomatic: false,
                reason: 'Receipt cancelled: ' . $reason,
            );

            return $receipt->fresh()->load('contract.client', 'contract.unit.building', 'installmentPayments.installment', 'downPayments');
        });
    }

    /** Part of the contract's agreed down payment (مقدم/تأمين), never more than what is still owed. */
    private function recordDownPayment(
        Contract $contract,
        float $amount,
        array $data,
        Receipt $receipt,
        $actor
    ): float {
        $remaining = (float) $contract->fresh()->remaining_down_payment;

        if ($amount > $remaining) {
            throw ValidationException::withMessages([
                'down_payment' => __('receipts.down_payment_exceeds_remaining'),
            ]);
        }

        $downPayment = ContractDownPayment::create([
            'contract_id' => $contract->id,
            'receipt_id' => $receipt->id,
            'amount' => round($amount, 2),
            'paid_at' => $data['paid_at'],
            'payment_method' => $data['payment_method'] ?? null,
            'notes' => $data['notes'] ?? null,
            'status' => PaymentStatus::VALID->value,
            'created_by' => $actor->id,
        ]);

        $this->audit->log(
            action: 'create',
            entityType: 'contract_down_payments',
            entityId: $downPayment->id,
            newValues: [
                'contract_id' => $contract->id,
                'amount' => round($amount, 2),
                'paid_at' => $data['paid_at'],
                'receipt_id' => $receipt->id,
            ],
            isAutomatic: true,
            reason: 'Down payment collected with receipt #' . $receipt->number,
        );

        return round($amount, 2);
    }

    /** `R-2026-00001`, sequential per year. */
    private function generateNumber(string $paidAt): string
    {
        $year = \Carbon\Carbon::parse($paidAt)->year;
        $prefix = 'R-' . $year . '-';

        $max = Receipt::withTrashed()
            ->where('number', 'like', $prefix . '%')
            ->lockForUpdate()
            ->max('number');

        $next = $max ? (int) substr($max, strlen($prefix)) + 1 : 1;

        return $prefix . str_pad((string) $next, 5, '0', STR_PAD_LEFT);
    }
}
