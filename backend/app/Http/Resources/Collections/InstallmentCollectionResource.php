<?php

namespace App\Http\Resources\Collections;

use App\Support\Money\Money;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of the collection page: an installment of an active contract, with the display status
 * recomputed against today (overdue overrides partial) instead of the stored status, which is only
 * refreshed when a payment is recorded.
 */
class InstallmentCollectionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $remaining = Money::fromString((string) $this->remaining);
        $paid = Money::fromString((string) $this->paid_amount);
        $isOverdue = $remaining->isPositive() && $this->due_date?->isBefore(Carbon::today());
        $status = ! $remaining->isPositive()
            ? 'paid'
            : ($isOverdue ? 'overdue' : ($paid->isPositive() ? 'partially_paid' : 'due'));

        return [
            'id' => $this->id,
            'kind' => 'installment',
            'contract_id' => $this->contract_id,
            'contract_number' => $this->whenLoaded('contract', fn () => $this->contract->number),
            'contract_type' => $this->whenLoaded('contract', fn () => $this->contract->type?->value),
            'client_id' => $this->whenLoaded('contract', fn () => $this->contract->client_id),
            'client_name' => $this->whenLoaded('contract', fn () => $this->contract->client?->name),
            'unit_id' => $this->whenLoaded('contract', fn () => $this->contract->unit_id),
            'unit_name' => $this->whenLoaded('contract', fn () => $this->contract->unit?->name),
            'building_name' => $this->whenLoaded('contract', fn () => $this->contract->unit?->building?->name),
            'sequence_number' => $this->sequence_number,
            'due_date' => $this->due_date?->toDateString(),
            'amount' => $this->amount,
            'paid_amount' => $this->paid_amount,
            'remaining' => $this->remaining,
            'status' => $status,
            'status_label' => __('enums.collection_status.' . $status),
            'is_overdue' => $isOverdue,
            'days_overdue' => $isOverdue ? (int) $this->due_date->diffInDays(Carbon::today()) : 0,
        ];
    }
}
