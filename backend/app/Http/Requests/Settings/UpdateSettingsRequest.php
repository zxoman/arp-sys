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
        ];
    }
}
