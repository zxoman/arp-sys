<?php

namespace App\Http\Requests\Units;

use App\Enums\UnitPurpose;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreUnitRequest extends FormRequest
{
    public function authorize(): bool
    {
        return auth()->user()?->hasPermission('units.create') ?? false;
    }

    public function rules(): array
    {
        return [
            'building_id' => ['required', 'exists:buildings,id'],
            'floor_id' => ['required', 'exists:floors,id'],
            'name' => ['required', 'string', 'max:255'],
            'type' => ['required', 'string', 'in:apartment,shop,warehouse,studio'],
            'activity' => ['sometimes', 'string', 'in:residential,administrative,commercial,medical,hotel'],
            'purpose' => ['sometimes', 'string', Rule::in(UnitPurpose::allValues())],
            'area' => ['required', 'numeric', 'min:0.01'],
            'price_per_meter' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sale_price' => ['sometimes', 'nullable', 'numeric', 'min:0.01'],
            'is_sellable' => ['sometimes', 'boolean'],
            'non_sellable_reason' => ['sometimes', 'nullable', 'string', 'max:255'],
            'rooms' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:20'],
            'bathrooms' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:20'],
        ];
    }
}
