<?php

namespace Database\Seeders;

use App\Models\Setting;
use App\Services\Settings\SettingsService;
use Illuminate\Database\Seeder;

class SettingsSeeder extends Seeder
{
    public function run(): void
    {
        // The company runs a single project: its data is entered once here.
        foreach ([
            SettingsService::PROJECT_NAME => env('PROJECT_NAME', ''),
            SettingsService::PROJECT_ADDRESS => env('PROJECT_ADDRESS', ''),
        ] as $key => $value) {
            Setting::firstOrCreate(
                ['key' => $key],
                ['value' => $value],
            );
        }
    }
}
