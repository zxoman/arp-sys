<?php

namespace App\Http\Resources\Contracts;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InstallmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'contract_id' => $this->contract_id,
            'sequence_number' => $this->sequence_number,
            'due_date' => $this->due_date,
            'amount' => $this->amount,
            'paid_amount' => $this->paid_amount,
            'remaining' => $this->remaining,
            'status' => $this->status?->value,
            'status_label' => $this->status?->label(),
            'is_overdue' => $this->isOverdue(),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}