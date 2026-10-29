<?php

namespace App\Services\Contracts;

use App\Models\Contract;
use App\Models\Installment;
use App\Models\InstallmentPayment;
use App\Enums\AuditAction;
use App\Enums\InstallmentStatus;
use App\Enums\PaymentStatus;
use App\Services\Audit\AuditLogger;
use App\Support\Transactions\Operation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class InstallmentService
{
    public function __construct(
        private Operation $operation,
        private AuditLogger $audit
    ) {
    }

    /**
     * Record a payment against an installment.
     * Amount may not exceed the installment's remaining balance.
     */
    public function recordPayment(int $contractId, int $installmentId, array $data, $actor, ?int $receiptId = null): InstallmentPayment
    {
        return DB::transaction(function () use ($contractId, $installmentId, $data, $actor, $receiptId) {
            $installment = Installment::where('id', $installmentId)
                ->where('contract_id', $contractId)
                ->lockForUpdate()
                ->first();

            if (!$installment) {
                throw ValidationException::withMessages([
                    'installment_id' => __('installments.installment_not_found'),
                ]);
            }

            // Only an active contract collects money: drafts have no installments and a cancelled
            // contract's schedule is closed.
            if (!$installment->contract?->isActive()) {
                throw ValidationException::withMessages([
                    'contract_id' => __('receipts.contract_not_active'),
                ]);
            }

            if ($installment->isCancelled()) {
                throw ValidationException::withMessages([
                    'installment_id' => __('installments.installment_cancelled'),
                ]);
            }

            $amount = (float) $data['amount'];
            if ($amount <= 0) {
                throw ValidationException::withMessages([
                    'amount' => __('installments.amount_must_be_positive'),
                ]);
            }

            // Amount may not exceed installment's remaining balance
            if ($amount > (float) $installment->remaining) {
                throw ValidationException::withMessages([
                    'amount' => __('installments.payment_exceeds_remaining'),
                ]);
            }

            $payment = InstallmentPayment::create([
                'contract_id' => $contractId,
                'installment_id' => $installmentId,
                'receipt_id' => $receiptId,
                'amount' => $data['amount'],
                'paid_at' => $data['paid_at'],
                'payment_method' => $data['payment_method'] ?? null,
                'notes' => $data['notes'] ?? null,
                'status' => PaymentStatus::VALID->value,
                'created_by' => $actor->id,
            ]);

            // Update installment paid_amount, remaining, status
            $newPaid = (float) $installment->paid_amount + $amount;
            $newRemaining = (float) $installment->remaining - $amount;

            $newStatus = $newRemaining <= 0
                ? InstallmentStatus::PAID->value
                : InstallmentStatus::PARTIALLY_PAID->value;

            $installment->update([
                'paid_amount' => round($newPaid, 2),
                'remaining' => round($newRemaining, 2),
                'status' => $newStatus,
            ]);

            $this->audit->log(
action: AuditAction::UPDATE->value,
            entityType: 'installment_payments',
            entityId: $payment->id,
            newValues: [
                'installment_id' => $installmentId,
                'amount' => $data['amount'],
                'paid_at' => $data['paid_at'],
            ],
            isAutomatic: true,
            reason: 'Installment payment recorded for installment #' . $installment->sequence_number,
            );

            return $payment->fresh();
        });
    }

    /**
     * Cancel an installment payment.
     */
    public function cancelPayment(InstallmentPayment $payment, string $reason, $actor): InstallmentPayment
    {
        if (!$payment->isValid()) {
            throw ValidationException::withMessages([
                'payment' => __('installments.payment_already_cancelled'),
            ]);
        }

        return DB::transaction(function () use ($payment, $reason, $actor) {
            $oldValues = [
                'amount' => $payment->amount,
                'status' => $payment->status,
            ];

            $payment->update([
                'status' => PaymentStatus::CANCELLED->value,
                'cancel_reason' => $reason,
                'cancelled_at' => $this->operation->now(),
            ]);

            // Recalculate installment from remaining valid payments
            $installment = $payment->installment;
            $validTotal = $installment->payments()
                ->where('status', PaymentStatus::VALID->value)
                ->whereNull('deleted_at')
                ->sum('amount');

            $newPaid = round((float) $validTotal, 2);
            $newRemaining = round((float) $installment->amount - (float) $validTotal, 2);
            // A cancelled contract's installments stay cancelled: only their amounts move.
            $newStatus = $installment->isCancelled()
                ? InstallmentStatus::CANCELLED->value
                : ($newRemaining <= 0
                    ? InstallmentStatus::PAID->value
                    : ($newPaid > 0 ? InstallmentStatus::PARTIALLY_PAID->value : InstallmentStatus::DUE->value));

            $installment->update([
                'paid_amount' => $newPaid,
                'remaining' => $newRemaining,
                'status' => $newStatus,
            ]);

            $this->audit->log(
action: AuditAction::UPDATE->value,
            entityType: 'installment_payments',
            entityId: $payment->id,
            oldValues: $oldValues,
            newValues: [
                'status' => 'cancelled',
                'cancel_reason' => $reason,
            ],
            changedFields: ['status', 'cancel_reason', 'cancelled_at'],
            reason: 'Installment payment cancelled: ' . $reason,
            );

            return $payment->fresh();
        });
    }

    /**
     * Schedule preview: compute installments without saving.
     */
    public function preview(array $data): array
    {
        $price = (float) ($data['total_price'] ?? 0);
        $downPayment = (float) ($data['agreed_down_payment'] ?? 0);
        $count = (int) ($data['installments_count'] ?? 0);
        $interval = (int) ($data['interval_months'] ?? 0);
        $startDate = \Carbon\Carbon::parse($data['first_installment_date']);

        if ($count <= 0) {
            return [
                'installments' => [],
                'total_remainder' => $price - $downPayment,
            ];
        }

        $remainder = $price - $downPayment;
        $installmentAmount = $remainder / $count;
        $baseAmount = floor($installmentAmount * 100) / 100;
        $remainingToDistribute = $remainder;

        $installments = [];

        for ($i = 1; $i <= $count; $i++) {
            $dueDate = $startDate->copy()->addMonths(($i - 1) * $interval);

            // Month-end handling
            $startDay = $startDate->day;
            $daysInMonth = \Carbon\Carbon::parse($dueDate)->daysInMonth;
            if ($startDay > $daysInMonth) {
                $dueDate = \Carbon\Carbon::parse($dueDate)->setDay($daysInMonth);
            }

            if ($i === $count) {
                $amount = $remainingToDistribute;
            } else {
                $amount = $baseAmount;
                $remainingToDistribute -= $baseAmount;
            }

            $installments[] = [
                'sequence_number' => $i,
                'due_date' => $dueDate->toDateString(),
                'amount' => round($amount, 2),
            ];
        }

        return [
            'installments' => $installments,
            'total_remainder' => $remainder,
            'per_installment' => round($baseAmount, 2),
            'last_installment_adjustment' => round($remainingToDistribute + $baseAmount - $installmentAmount, 2),
        ];
    }
}