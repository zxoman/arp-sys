<?php

namespace App\Http\Requests\Units;

use App\Enums\UnitPurpose;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateUnitRequest extends FormRequest
{
    public function authorize(): bool
    {
        return auth()->user()?->hasPermission('units.update') ?? false;
    }

    public function rules(): array
    {
        return [
            'building_id' => ['sometimes', 'exists:buildings,id'],
            'name' => ['sometimes', 'string', 'max:255'],
            'floor_id' => ['sometimes', 'exists:floors,id'],
            'type' => ['sometimes', 'string', 'in:apartment,shop,warehouse,studio'],
            'activity' => ['sometimes', 'string', 'in:residential,administrative,commercial,medical,hotel'],
            'purpose' => ['sometimes', 'string', Rule::in(UnitPurpose::allValues())],
            'area' => ['sometimes', 'numeric', 'min:0.01'],
            'price_per_meter' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sale_price' => ['sometimes', 'nullable', 'numeric', 'min:0.01'],
            'is_sellable' => ['sometimes', 'boolean'],
            'non_sellable_reason' => ['sometimes', 'nullable', 'string', 'max:255'],
            'rooms' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:20'],
            'bathrooms' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:20'],
        ];
    }
}
