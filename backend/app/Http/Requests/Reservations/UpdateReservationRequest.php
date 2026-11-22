<?php

namespace App\Http\Requests\Reservations;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Editing an **active** reservation (owner decision 2026-11-21): the client, the unit (or the
 * building for a building-level reservation) and the date may change. Money never moves here —
 * payments are added/cancelled through the payments endpoints, and a converted/cancelled reservation
 * is not editable at all (the service checks that).
 */
class UpdateReservationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'client_id' => ['sometimes', 'required', 'exists:clients,id'],
            'building_id' => ['sometimes', 'nullable', 'exists:buildings,id'],
            'unit_id' => ['sometimes', 'nullable', 'exists:units,id'],
            'reservation_date' => ['sometimes', 'required', 'date'],
        ];
    }
}
