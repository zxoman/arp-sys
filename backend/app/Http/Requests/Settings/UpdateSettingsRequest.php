<?php

namespace App\Http\Requests\Settings;

use Illuminate\Foundation\Http\FormRequest;

class UpdateSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'project_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'project_address' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'company_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'company_address' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'company_phone' => ['sometimes', 'nullable', 'string', 'max:50'],
            // Logos arrive as data URLs (the settings screen reads them from the picked file).
            'company_logo' => ['sometimes', 'nullable', 'string', 'max:2000000'],
            'our_logo' => ['sometimes', 'nullable', 'string', 'max:2000000'],
            'show_company_logo' => ['sometimes', 'boolean'],
            'show_our_logo' => ['sometimes', 'boolean'],
            'developer_url' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }
}
