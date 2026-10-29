<?php

namespace App\SystemTest\Journeys;

use App\Models\Role;
use App\Models\User;
use App\SystemTest\Journey;
use Illuminate\Support\Facades\Artisan;

class AuthJourney extends Journey
{
    public function __construct()
    {
        parent::__construct('Auth Journey');
    }

    public function run(): \App\SystemTest\JourneyResult
    {
        // Seed an admin role and user
        Artisan::call('db:seed', ['--class' => 'SystemTestAdminSeeder']);

        $admin = User::where('username', 'admin')->first();

        // Step 1: Login
        $response = $this->runHttpCall(function () use ($admin) {
            return \Illuminate\Support\Facades\Http::postJson('/api/v1/auth/login', [
                'login' => 'admin',
                'password' => 'password123',
            ]);
        }, 'login');

        $this->assertStatus($response, 200, 'login');

        $token = $response['json']['data']['token'] ?? '';
        $headers = ['Authorization' => 'Bearer ' . $token];

        // Step 2: View own profile
        $response = $this->runHttpCall(function () use ($headers) {
            return \Illuminate\Support\Facades\Http::withHeaders($headers)
                ->getJson('/api/v1/auth/me');
        }, 'view profile');

        $this->assertStatus($response, 200, 'view profile');

        // Step 3: Update profile
        $response = $this->runHttpCall(function () use ($headers) {
            return \Illuminate\Support\Facades\Http::withHeaders($headers)
                ->putJson('/api/v1/auth/profile', ['name' => 'Updated Admin']);
        }, 'update profile');

        $this->assertStatus($response, 200, 'update profile');

        // Step 4: Login with wrong password (should fail)
        $response = $this->runHttpCall(function () use ($admin) {
            return \Illuminate\Support\Facades\Http::postJson('/api/v1/auth/login', [
                'login' => 'admin',
                'password' => 'wrongpassword',
            ]);
        }, 'login wrong password');

        $this->assertStatus($response, 422, 'login wrong password');

        // Step 5: Logout
        $response = $this->runHttpCall(function () use ($headers) {
            return \Illuminate\Support\Facades\Http::withHeaders($headers)
                ->postJson('/api/v1/auth/logout');
        }, 'logout');

        $this->assertStatus($response, 200, 'logout');

        return $this->result;
    }
}
