<?php

namespace App\Http\Resources\Receipts;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ReceiptResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'number' => $this->number,
            'contract_id' => $this->contract_id,
            'contract_number' => $this->whenLoaded('contract', fn () => $this->contract->number),
            'contract_type' => $this->whenLoaded('contract', fn () => $this->contract->type?->value),
            'contract_type_label' => $this->whenLoaded('contract', fn () => $this->contract->type?->label()),
            'client_id' => $this->whenLoaded('contract', fn () => $this->contract->client_id),
            'client_name' => $this->whenLoaded('contract', fn () => $this->contract->client?->name),
            'client_phone' => $this->whenLoaded('contract', fn () => $this->contract->client?->phone),
            'unit_id' => $this->whenLoaded('contract', fn () => $this->contract->unit_id),
            'unit_name' => $this->whenLoaded('contract', fn () => $this->contract->unit?->name),
            'unit_type_label' => $this->whenLoaded('contract', fn () => $this->contract->unit?->type?->label()),
            'building_name' => $this->whenLoaded('contract', fn () => $this->contract->unit?->building?->name),
            'paid_at' => $this->paid_at,
            'payment_method' => $this->payment_method,
            'payment_method_label' => $this->payment_method
                ? (\App\Enums\PaymentMethod::tryFrom($this->payment_method)?->label())
                : null,
            'reference' => $this->reference,
            'notes' => $this->notes,
            'total_amount' => $this->total_amount,
            'status' => $this->status?->value,
            'status_label' => $this->status?->label(),
            'cancel_reason' => $this->cancel_reason,
            'cancelled_at' => $this->cancelled_at,
            'created_by_name' => $this->whenLoaded('createdBy', fn () => $this->createdBy?->name),
            'installments' => $this->whenLoaded('installmentPayments', fn () => $this->installmentPayments
                ->map(fn ($payment) => [
                    'payment_id' => $payment->id,
                    'installment_id' => $payment->installment_id,
                    'sequence_number' => $payment->installment?->sequence_number,
                    'due_date' => $payment->installment?->due_date,
                    'amount' => $payment->amount,
                    'status' => $payment->status?->value,
                    'cancel_reason' => $payment->cancel_reason,
                ])
                ->values()),
            'down_payment' => $this->whenLoaded('downPayments', function () {
                $payment = $this->downPayments->first();

                return $payment ? [
                    'payment_id' => $payment->id,
                    'amount' => $payment->amount,
                    'status' => $payment->status?->value,
                    'cancel_reason' => $payment->cancel_reason,
                ] : null;
            }),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
