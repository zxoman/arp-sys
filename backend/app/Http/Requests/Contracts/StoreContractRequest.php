<?php

namespace App\Http\Requests\Contracts;

use Illuminate\Foundation\Http\FormRequest;

class StoreContractRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'reservation_id' => ['sometimes', 'nullable', 'exists:reservations,id'],
            'type' => ['required', 'string', 'in:sale,rent'],
            'status' => ['sometimes', 'nullable', 'string', 'in:draft,active'],
            'client_id' => ['required', 'exists:clients,id'],
            'unit_id' => ['required', 'exists:units,id'],
            'contract_date' => ['required', 'date'],
            // Sale: the agreed net price. Rent: optional — it is the schedule total (or rent × months).
            'total_price' => ['required_if:type,sale', 'nullable', 'numeric', 'min:0.01'],
            'discount' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'discount_reason' => ['sometimes', 'nullable', 'string', 'max:255'],
            'agreed_down_payment' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'installments_count' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:360'],
            'first_installment_date' => ['sometimes', 'nullable', 'date'],
            'interval_months' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:120'],
            // Lease terms.
            'monthly_rent' => ['sometimes', 'nullable', 'numeric', 'min:0.01'],
            'duration_months' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:600'],
            'start_date' => ['sometimes', 'nullable', 'date'],
            'end_date' => ['sometimes', 'nullable', 'date', 'after_or_equal:start_date'],
            'security_deposit' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'advance_months' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'annual_increase_pct' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:100'],
            'increase_from_year' => ['sometimes', 'nullable', 'integer', 'min:1'],
            // Free schedule, as built on the contracts screen.
            'schedule' => ['sometimes', 'array', 'max:600'],
            'schedule.*.due_date' => ['required', 'date'],
            'schedule.*.amount' => ['required', 'numeric', 'min:0.01'],
            'schedule.*.is_down_payment' => ['sometimes', 'boolean'],
            'schedule.*.paid_amount' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'notes' => ['sometimes', 'nullable', 'string'],
        ];
    }

    public function messages(): array
    {
        return [
            'total_price.required_if' => __('contracts.price_required_for_sale'),
        ];
    }
}
