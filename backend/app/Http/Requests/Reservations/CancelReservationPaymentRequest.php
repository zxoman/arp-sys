<?php

namespace App\Http\Requests\Reservations;

use Illuminate\Foundation\Http\FormRequest;

class CancelReservationPaymentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return auth()->user()?->hasPermission('payments.cancel') ?? false;
    }

    public function rules(): array
    {
        return [
            'cancel_reason' => ['required', 'string'],
        ];
    }
}