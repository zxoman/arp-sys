<?php

namespace App\Http\Requests\Contracts;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Editing a contract (owner decision 2026-11-21).
 *
 * - A **draft** may change anything.
 * - An **active** contract may change its data **and its money**: the schedule is replanned, but
 *   only over the rows that still owe nothing (`paid_amount = 0`). Rows that already collected money
 *   keep their amount and due date, receipts are never touched, and the new price may not fall below
 *   what was already collected.
 * - A cancelled contract is locked.
 *
 * Every field is optional: fields left out keep their stored value.
 */
class UpdateContractRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type' => ['sometimes', 'required', 'string', 'in:sale,rent'],
            'client_id' => ['sometimes', 'required', 'exists:clients,id'],
            'unit_id' => ['sometimes', 'required', 'exists:units,id'],
            'contract_date' => ['sometimes', 'required', 'date'],
            'total_price' => ['sometimes', 'nullable', 'numeric', 'min:0.01'],
            'discount' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'discount_reason' => ['sometimes', 'nullable', 'string', 'max:255'],
            'agreed_down_payment' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'installments_count' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:360'],
            'first_installment_date' => ['sometimes', 'nullable', 'date'],
            'interval_months' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:120'],
            'monthly_rent' => ['sometimes', 'nullable', 'numeric', 'min:0.01'],
            'duration_months' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:600'],
            'start_date' => ['sometimes', 'nullable', 'date'],
            'end_date' => ['sometimes', 'nullable', 'date', 'after_or_equal:start_date'],
            'security_deposit' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'advance_months' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'annual_increase_pct' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:100'],
            'increase_from_year' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'schedule' => ['sometimes', 'array', 'max:600'],
            'schedule.*.installment_id' => ['sometimes', 'nullable', 'integer'],
            'schedule.*.due_date' => ['required', 'date'],
            'schedule.*.amount' => ['required', 'numeric', 'min:0.01'],
            'schedule.*.is_down_payment' => ['sometimes', 'boolean'],
            'schedule.*.paid_amount' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'notes' => ['sometimes', 'nullable', 'string'],
        ];
    }
}
