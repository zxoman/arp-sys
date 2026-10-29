<?php

namespace App\Http\Requests\Contracts;

use Illuminate\Foundation\Http\FormRequest;

class RecordInstallmentPaymentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return auth()->user()?->hasPermission('payments.create') ?? false;
    }

    public function rules(): array
    {
        return [
            'amount' => ['required', 'numeric', 'min:0.01'],
            'paid_at' => ['sometimes', 'nullable', 'date'],
            'payment_method' => ['sometimes', 'nullable', 'string', 'in:' . implode(',', \App\Enums\PaymentMethod::allValues())],
            'notes' => ['sometimes', 'nullable', 'string'],
        ];
    }
}