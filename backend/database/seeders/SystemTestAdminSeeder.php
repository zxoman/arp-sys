<?php

namespace Database\Seeders;

use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Seeder;

class SystemTestAdminSeeder extends Seeder
{
    public function run(): void
    {
        $role = Role::firstOrCreate(
            ['name' => 'admin'],
            [
                'display_name' => 'مدير النظام',
                'is_admin' => true,
                'lock_version' => 0,
            ]
        );

        User::firstOrCreate(
            ['username' => 'admin'],
            [
                'name' => 'Admin User',
                'email' => 'admin@example.com',
                'phone' => '+201000000000',
                'password' => bcrypt('password123'),
                'role_id' => $role->id,
                'status' => 'active',
                'lock_version' => 0,
            ]
        );
    }
}
