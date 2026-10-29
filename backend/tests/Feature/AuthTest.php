<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Enums\UserStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    protected function createAdmin(): User
    {
        $role = Role::create([
            'name' => 'admin',
            'display_name' => 'مدير النظام',
            'is_admin' => true,
        ]);

        return User::create([
            'name' => 'Admin User',
            'username' => 'admin',
            'email' => 'admin@example.com',
            'phone' => '+201000000000',
            'password' => bcrypt('password123'),
            'role_id' => $role->id,
            'status' => UserStatus::ACTIVE,
            'lock_version' => 0,
        ]);
    }

    public function test_admin_can_log_in_with_username(): void
    {
        $user = $this->createAdmin();

        $response = $this->postJson('/api/v1/auth/login', [
            'login' => 'admin',
            'password' => 'password123',
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['token', 'user']]);
        $this->assertNotEmpty($response->json('data.token'));
    }

    public function test_admin_can_log_in_with_email(): void
    {
        $this->createAdmin();

        $response = $this->postJson('/api/v1/auth/login', [
            'login' => 'admin@example.com',
            'password' => 'password123',
        ]);

        $response->assertStatus(200);
    }

    public function test_login_fails_with_wrong_password(): void
    {
        $this->createAdmin();

        $response = $this->postJson('/api/v1/auth/login', [
            'login' => 'admin',
            'password' => 'wrongpassword',
        ]);

        $response->assertStatus(422);
    }

    public function test_login_fails_for_inactive_user(): void
    {
        $user = $this->createAdmin();
        $user->update(['status' => UserStatus::SUSPENDED]);

        $response = $this->postJson('/api/v1/auth/login', [
            'login' => 'admin',
            'password' => 'password123',
        ]);

        $response->assertStatus(422);
    }

    public function test_account_locks_after_5_failed_attempts(): void
    {
        $this->createAdmin();

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/auth/login', [
                'login' => 'admin',
                'password' => 'wrongpassword',
            ]);
        }

        $user = User::where('username', 'admin')->first();
        $this->assertTrue($user->isLocked());

        $response = $this->postJson('/api/v1/auth/login', [
            'login' => 'admin',
            'password' => 'password123',
        ]);
        $response->assertStatus(422);
    }

    public function test_authenticated_user_can_view_own_profile(): void
    {
        $user = $this->createAdmin();
        $token = $this->getAuthToken($user);

        $response = $this->withHeaders(['Authorization' => 'Bearer '.$token])
            ->getJson('/api/v1/auth/me');

        $response->assertStatus(200);
        $response->assertJson(['data' => ['username' => 'admin']]);
    }

    public function test_authenticated_user_can_update_own_profile(): void
    {
        $user = $this->createAdmin();
        $token = $this->getAuthToken($user);

        $response = $this->withHeaders(['Authorization' => 'Bearer '.$token])
            ->putJson('/api/v1/auth/profile', [
                'name' => 'Updated Name',
            ]);

        $response->assertStatus(200);
        $response->assertJson(['data' => ['name' => 'Updated Name']]);
    }

    public function test_authenticated_user_can_change_password(): void
    {
        $user = $this->createAdmin();
        $token = $this->getAuthToken($user);

        $response = $this->withHeaders(['Authorization' => 'Bearer '.$token])
            ->postJson('/api/v1/auth/password', [
                'old_password' => 'password123',
                'new_password' => 'newpassword123',
            ]);

        $response->assertStatus(200);

        $this->postJson('/api/v1/auth/login', [
            'login' => 'admin',
            'password' => 'password123',
        ])->assertStatus(422);

        $this->postJson('/api/v1/auth/login', [
            'login' => 'admin',
            'password' => 'newpassword123',
        ])->assertStatus(200);
    }

    public function test_change_password_fails_with_wrong_old_password(): void
    {
        $user = $this->createAdmin();
        $token = $this->getAuthToken($user);

        $response = $this->withHeaders(['Authorization' => 'Bearer '.$token])
            ->postJson('/api/v1/auth/password', [
                'old_password' => 'wrongold',
                'new_password' => 'newpassword123',
            ]);

        $response->assertStatus(422);
    }

    public function test_authenticated_user_can_log_out(): void
    {
        $user = $this->createAdmin();
        $token = $this->getAuthToken($user);

        $response = $this->withHeaders(['Authorization' => 'Bearer '.$token])
            ->postJson('/api/v1/auth/logout');

        $response->assertStatus(200);
    }

    protected function getAuthToken(User $user, string $password = 'password123'): string
    {
        $response = $this->postJson('/api/v1/auth/login', [
            'login' => $user->username,
            'password' => $password,
        ]);

        return $response->json('data.token');
    }
}
