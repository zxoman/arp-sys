<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // First admin (username: admin, password: password123). Change the password after first login.
        $this->call(SystemTestAdminSeeder::class);

        // Single project data (name/address) entered once.
        $this->call(SettingsSeeder::class);
    }
}
