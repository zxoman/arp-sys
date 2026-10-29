<?php

namespace App\Http\Requests\Contracts;

use Illuminate\Foundation\Http\FormRequest;

class PreviewScheduleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'total_price' => ['required', 'numeric', 'min:0.01'],
            'agreed_down_payment' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'installments_count' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'first_installment_date' => ['sometimes', 'nullable', 'date'],
            'interval_months' => ['sometimes', 'nullable', 'integer', 'min:1'],
        ];
    }
}