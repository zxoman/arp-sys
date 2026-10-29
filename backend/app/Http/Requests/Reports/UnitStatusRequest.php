<?php

namespace App\Http\Requests\Reports;

use App\Enums\UnitPurpose;
use App\Enums\UnitType;
use Illuminate\Foundation\Http\FormRequest;

class UnitStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'building_id' => ['sometimes', 'nullable', 'exists:buildings,id'],
            'floor_id' => ['sometimes', 'nullable', 'exists:floors,id'],
            'type' => ['sometimes', 'nullable', 'in:'.implode(',', UnitType::allValues())],
            'purpose' => ['sometimes', 'nullable', 'in:'.implode(',', UnitPurpose::allValues())],
        ];
    }
}
