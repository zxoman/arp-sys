<?php

namespace App\Http\Requests\Buildings;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreBuildingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return auth()->user()?->hasPermission('buildings.create') ?? false;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'city' => ['required', 'string', 'max:255'],
            'district' => ['required', 'string', 'max:255'],
            'type' => ['required', 'string', 'in:building,tower,house,office_building'],
            'activities' => ['required', 'array', 'min:1'],
            'activities.*' => ['string', 'distinct', 'in:residential,administrative,commercial,medical,hotel'],
            'floors_count' => ['required', 'integer', 'min:0'],
            'total_units' => ['required', 'integer', 'min:0'],
            'has_basement' => ['sometimes', 'boolean'],

            // Optional extras (not part of the standard form).
            'number' => ['sometimes', 'nullable', 'string', 'max:50', Rule::unique('buildings')],
            'area' => ['sometimes', 'nullable', 'numeric', 'min:0.01'],
            'units_per_floor' => ['sometimes', 'nullable', 'integer', 'min:0'],
        ];
    }
}
