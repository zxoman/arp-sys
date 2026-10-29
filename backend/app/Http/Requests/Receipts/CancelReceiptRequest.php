<?php

namespace App\Http\Requests\Receipts;

use Illuminate\Foundation\Http\FormRequest;

class CancelReceiptRequest extends FormRequest
{
    public function authorize(): bool
    {
        return auth()->user()?->hasPermission('payments.cancel') ?? false;
    }

    public function rules(): array
    {
        return [
            'cancel_reason' => ['required', 'string', 'max:500'],
        ];
    }
}
