<?php

namespace App\Services\Reservations;

use App\Models\Reservation;
use App\Models\ReservationPayment;
use App\Enums\AuditAction;
use App\Enums\PaymentStatus;
use App\Services\Audit\AuditLogger;
use App\Support\Transactions\Operation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ReservationPaymentService
{
    public function __construct(
        private Operation $operation,
        private AuditLogger $audit
    ) {
    }

    public function create(int $reservationId, array $data, $actor): ReservationPayment
    {
        return DB::transaction(function () use ($reservationId, $data, $actor) {
            $amount = (float) $data['amount'];
            if ($amount <= 0) {
                throw ValidationException::withMessages([
                    'amount' => __('reservation_payments.amount_must_be_positive'),
                ]);
            }

            // `paid_at` is optional; default to today so the row is complete.
            $paidAt = $data['paid_at'] ?? now()->toDateString();

            $reservation = Reservation::findOrFail($reservationId);

            // Only active reservations can receive payments
            if (!$reservation->isActive()) {
                throw ValidationException::withMessages([
                    'reservation' => __('reservation_payments.cannot_pay_non_active'),
                ]);
            }

            $payment = ReservationPayment::create([
                'reservation_id' => $reservationId,
                'amount' => $data['amount'],
                'paid_at' => $paidAt,
                'payment_method' => $data['payment_method'] ?? null,
                'notes' => $data['notes'] ?? null,
                'status' => 'valid',
                'created_by' => $actor->id,
            ]);

            $this->audit->log(
                action: AuditAction::UPDATE->value,
                entityType: 'reservation_payments',
                entityId: $payment->id,
                newValues: [
                    'reservation_id' => $reservationId,
                    'amount' => $data['amount'],
                    'paid_at' => $paidAt,
                ],
                isAutomatic: true,
                reason: 'Payment recorded for reservation #' . $reservationId,
            );

            return $payment->load('reservation');
        });
    }

    public function cancel(ReservationPayment $payment, string $reason, $actor): ReservationPayment
    {
        if (!$payment->isValid()) {
            throw ValidationException::withMessages([
                'payment' => __('reservation_payments.already_cancelled'),
            ]);
        }

        return DB::transaction(function () use ($payment, $reason, $actor) {
            $oldValues = [
                'amount' => $payment->amount,
                'status' => $payment->status,
            ];

            $payment->update([
                'status' => 'cancelled',
                'cancel_reason' => $reason,
                'cancelled_at' => $this->operation->now(),
            ]);

            $this->audit->log(
                action: AuditAction::UPDATE->value,
                entityType: 'reservation_payments',
                entityId: $payment->id,
                oldValues: $oldValues,
                newValues: [
                    'status' => 'cancelled',
                    'cancel_reason' => $reason,
                ],
                changedFields: ['status', 'cancel_reason', 'cancelled_at'],
                reason: 'Payment cancelled: ' . $reason,
            );

            return $payment->fresh();
        });
    }
}