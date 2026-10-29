<?php

namespace App\Http\Requests\Reservations;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class StoreReservationRequest extends FormRequest
{
public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'client_id' => ['required', 'exists:clients,id'],
            'building_id' => ['sometimes', 'nullable', 'exists:buildings,id'],
            'unit_id' => ['sometimes', 'nullable', 'exists:units,id'],
            'unit_type' => ['sometimes', 'nullable', 'string', 'in:apartment,shop,warehouse,studio'],
            'unit_activity' => ['sometimes', 'nullable', 'string', 'in:residential,administrative,commercial,medical,hotel'],
            'reservation_date' => ['required', 'date'],
            'first_payment' => ['sometimes', 'array'],
            'first_payment.amount' => ['sometimes', 'nullable', 'numeric', 'min:0.01'],
            'first_payment.paid_at' => ['sometimes', 'nullable', 'date'],
            'first_payment.payment_method' => ['sometimes', 'nullable', 'string', 'in:' . implode(',', \App\Enums\PaymentMethod::allValues())],
            'first_payment.notes' => ['sometimes', 'nullable', 'string'],
        ];
    }
}