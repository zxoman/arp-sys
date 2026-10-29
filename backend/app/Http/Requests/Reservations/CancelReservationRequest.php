<?php

namespace App\Http\Requests\Reservations;

use Illuminate\Foundation\Http\FormRequest;

class CancelReservationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return auth()->user()?->hasPermission('reservations.cancel') ?? false;
    }

    public function rules(): array
    {
        return [
            'cancellation_reason' => ['required', 'string'],
        ];
    }
}