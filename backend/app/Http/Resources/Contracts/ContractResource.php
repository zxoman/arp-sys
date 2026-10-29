<?php

namespace App\Http\Resources\Contracts;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ContractResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $downPaid = (float) ($this->down_payments_sum ?? 0);
        $installmentPaid = (float) ($this->installment_payments_sum ?? 0);
        $hasSums = array_key_exists('down_payments_sum', $this->getAttributes());
        $reservationDeposit = $this->relationLoaded('reservation') ? (float) ($this->reservation?->deposit_paid ?? 0) : 0;

        $paidTotal = $hasSums ? $downPaid + $installmentPaid + $reservationDeposit : (float) $this->total_collected + $reservationDeposit;
        $paidDownPayment = $hasSums ? $reservationDeposit + $downPaid : (float) $this->paid_down_payment;
        $remainingDownPayment = max(0, (float) $this->agreed_down_payment - $paidDownPayment);
        $contractValue = (float) $this->total_price;

        return [
            'id' => $this->id,
            'number' => $this->number,
            'type' => $this->type?->value,
            'type_label' => $this->type?->label(),
            'reservation_id' => $this->reservation_id,
            'client_id' => $this->client_id,
            'client_name' => $this->whenLoaded('client', fn () => $this->client->name),
            'client_phone' => $this->whenLoaded('client', fn () => $this->client->phone),
            'unit_id' => $this->unit_id,
            'unit_name' => $this->whenLoaded('unit', fn () => $this->unit->name),
            'unit_type' => $this->whenLoaded('unit', fn () => $this->unit->type?->value),
            'unit_type_label' => $this->whenLoaded('unit', fn () => $this->unit->type?->label()),
            'unit_area' => $this->whenLoaded('unit', fn () => $this->unit->area),
            'building_id' => $this->whenLoaded('unit', fn () => $this->unit->building_id),
            'building_name' => $this->whenLoaded('unit', fn () => $this->unit->building?->name),
            'contract_date' => $this->contract_date,
            'total_price' => $this->total_price,
            'discount' => $this->discount,
            'discount_reason' => $this->discount_reason,
            'agreed_down_payment' => $this->agreed_down_payment,
            'paid_down_payment' => round($paidDownPayment, 2),
            'remaining_down_payment' => round($remainingDownPayment, 2),
            'installments_count' => $this->installments_count,
            'first_installment_date' => $this->first_installment_date,
            'interval_months' => $this->interval_months,
            'monthly_rent' => $this->monthly_rent,
            'duration_months' => $this->duration_months,
            'start_date' => $this->start_date,
            'end_date' => $this->end_date,
            'security_deposit' => $this->security_deposit,
            'advance_months' => $this->advance_months,
            'annual_increase_pct' => $this->annual_increase_pct,
            'increase_from_year' => $this->increase_from_year,
            'draft_schedule' => $this->draft_schedule,
            'contract_value' => $contractValue,
            'paid_total' => round($paidTotal, 2),
            'remaining_total' => round(max(0, $contractValue - $paidTotal), 2),
            'total_collected' => round($hasSums ? $downPaid + $installmentPaid : (float) $this->total_collected, 2),
            'notes' => $this->notes,
            'status' => $this->status?->value,
            'status_label' => $this->status?->label(),
            'cancelled_at' => $this->cancelled_at,
            'cancellation_reason' => $this->cancellation_reason,
            'installments' => InstallmentResource::collection($this->whenLoaded('installments')),
            'down_payments' => $this->whenLoaded('downPayments'),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'deleted_at' => $this->deleted_at,
        ];
    }
}
