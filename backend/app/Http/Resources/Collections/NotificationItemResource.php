<?php

namespace App\Http\Resources\Collections;

use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** One bell alert: an unpaid installment or rent payment that is overdue or due today. */
class NotificationItemResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $daysOverdue = $this->isOverdue() ? (int) $this->due_date->diffInDays(Carbon::today()) : 0;

        return [
            'key' => 'installment:' . $this->id,
            'installment_id' => $this->id,
            'contract_id' => $this->contract_id,
            'contract_number' => $this->whenLoaded('contract', fn () => $this->contract->number),
            'contract_type' => $this->whenLoaded('contract', fn () => $this->contract->type?->value),
            'client_id' => $this->whenLoaded('contract', fn () => $this->contract->client_id),
            'client_name' => $this->whenLoaded('contract', fn () => $this->contract->client?->name),
            'unit_name' => $this->whenLoaded('contract', fn () => $this->contract->unit?->name),
            'building_name' => $this->whenLoaded('contract', fn () => $this->contract->unit?->building?->name),
            'sequence_number' => $this->sequence_number,
            'due_date' => $this->due_date?->toDateString(),
            'amount' => $this->amount,
            'paid_amount' => $this->paid_amount,
            'remaining' => $this->remaining,
            'is_overdue' => $this->isOverdue(),
            'days_overdue' => $daysOverdue,
        ];
    }
}
