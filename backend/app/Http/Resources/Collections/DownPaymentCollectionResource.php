<?php

namespace App\Http\Resources\Collections;

use App\Support\Money\Money;
use App\Support\Money\MoneyCalculator;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of the collection page's «المقدمات» tab: the down payment (مقدم/تأمين) of an active
 * contract, shown as a single row due on the contract date. Its paid amount is the reservation
 * deposit (if the contract came from a reservation) plus every valid down-payment receipt.
 */
class DownPaymentCollectionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $paid = Money::fromString($this->paid_down_payment);
        $remaining = Money::fromString(MoneyCalculator::remaining(
            (string) $this->agreed_down_payment,
            $this->paid_down_payment
        ));
        $isOverdue = $remaining->isPositive() && $this->contract_date?->isBefore(Carbon::today());
        $status = ! $remaining->isPositive()
            ? 'paid'
            : ($isOverdue ? 'overdue' : ($paid->isPositive() ? 'partially_paid' : 'due'));

        return [
            'id' => $this->id,
            'kind' => 'down_payment',
            'contract_id' => $this->id,
            'contract_number' => $this->number,
            'contract_type' => $this->type?->value,
            'client_id' => $this->client_id,
            'client_name' => $this->client?->name,
            'unit_id' => $this->unit_id,
            'unit_name' => $this->unit?->name,
            'building_name' => $this->unit?->building?->name,
            'sequence_number' => 0,
            'due_date' => $this->contract_date?->toDateString(),
            'amount' => $this->agreed_down_payment,
            'paid_amount' => $this->paid_down_payment,
            'remaining' => $remaining->toString(),
            'status' => $status,
            'status_label' => __('enums.collection_status.' . $status),
            'is_overdue' => $isOverdue,
            'days_overdue' => $isOverdue ? (int) $this->contract_date->diffInDays(Carbon::today()) : 0,
        ];
    }
}
