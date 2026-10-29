<?php

namespace App\Http\Requests\Reports;

use Illuminate\Foundation\Http\FormRequest;

class SalesReportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'from_date' => ['required', 'date'],
            'to_date' => ['required', 'date', 'after_or_equal:from_date'],
            'building_id' => ['sometimes', 'nullable', 'exists:buildings,id'],
            'unit_type' => ['sometimes', 'nullable', 'string', 'in:apartment,shop,warehouse,studio'],
            'activity' => ['sometimes', 'nullable', 'string', 'in:residential,administrative,commercial,medical,hotel'],
            'contract_type' => ['sometimes', 'nullable', 'string', 'in:sale,rent'],
            'user_id' => ['sometimes', 'nullable', 'exists:users,id'],
        ];
    }
}