<?php

namespace App\Http\Requests\Contracts;

use Illuminate\Foundation\Http\FormRequest;

class CancelContractRequest extends FormRequest
{
    public function authorize(): bool
    {
        return auth()->user()?->hasPermission('contracts.cancel') ?? false;
    }

    public function rules(): array
    {
        return [
            'cancellation_reason' => ['required', 'string'],
        ];
    }
}