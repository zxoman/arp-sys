<?php

namespace App\Http\Requests\Buildings;

use Illuminate\Foundation\Http\FormRequest;

class UpdateBuildingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return auth()->user()?->hasPermission('buildings.update') ?? false;
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'city' => ['sometimes', 'string', 'max:255'],
            'district' => ['sometimes', 'string', 'max:255'],
            'type' => ['sometimes', 'string', 'in:building,tower,house,office_building'],
            'activities' => ['sometimes', 'array', 'min:1'],
            'activities.*' => ['string', 'distinct', 'in:residential,administrative,commercial,medical,hotel'],
            'floors_count' => ['sometimes', 'integer', 'min:0'],
            'total_units' => ['sometimes', 'integer', 'min:0'],
            'has_basement' => ['sometimes', 'boolean'],

            // Optional extras (not part of the standard form).
            'number' => ['sometimes', 'nullable', 'string', 'max:50'],
            'area' => ['sometimes', 'nullable', 'numeric', 'min:0.01'],
            'units_per_floor' => ['sometimes', 'nullable', 'integer', 'min:0'],
        ];
    }
}
