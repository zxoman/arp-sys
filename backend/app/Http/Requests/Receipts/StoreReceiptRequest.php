<?php

namespace App\Http\Requests\Receipts;

use App\Enums\PaymentMethod;
use Illuminate\Foundation\Http\FormRequest;

class StoreReceiptRequest extends FormRequest
{
    public function authorize(): bool
    {
        return auth()->user()?->hasPermission('payments.create') ?? false;
    }

    public function rules(): array
    {
        return [
            'contract_id' => ['required', 'integer', 'exists:contracts,id'],
            'paid_at' => ['required', 'date'],
            'payment_method' => ['sometimes', 'nullable', 'string', 'in:' . implode(',', PaymentMethod::allValues())],
            'reference' => ['sometimes', 'nullable', 'string', 'max:100'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'installments' => ['sometimes', 'array', 'max:120'],
            'installments.*.installment_id' => ['required', 'integer', 'distinct', 'exists:installments,id'],
            'installments.*.amount' => ['required', 'numeric', 'min:0.01'],
            'down_payment' => ['sometimes', 'nullable', 'numeric', 'min:0.01'],
        ];
    }

    public function messages(): array
    {
        return [
            'installments.*.installment_id.distinct' => __('receipts.duplicate_installment'),
        ];
    }
}
