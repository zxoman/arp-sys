<?php

namespace App\Http\Requests\Contracts;

use Illuminate\Foundation\Http\FormRequest;

class PostContractRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'schedule' => ['sometimes', 'array', 'max:600'],
            'schedule.*.due_date' => ['required', 'date'],
            'schedule.*.amount' => ['required', 'numeric', 'min:0.01'],
            'schedule.*.is_down_payment' => ['sometimes', 'boolean'],
            'schedule.*.paid_amount' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'notes' => ['sometimes', 'nullable', 'string'],
        ];
    }
}
