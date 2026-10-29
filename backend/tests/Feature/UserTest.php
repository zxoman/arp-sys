<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Enums\UserStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserTest extends TestCase
{
    use RefreshDatabase;

    protected function createAdmin(): array
    {
        $role = Role::create([
            'name' => 'admin',
            'display_name' => 'مدير النظام',
            'is_admin' => true,
        ]);

        $user = User::create([
            'name' => 'Admin User',
            'username' => 'admin',
            'email' => 'admin@example.com',
            'password' => bcrypt('password123'),
            'role_id' => $role->id,
            'status' => UserStatus::ACTIVE,
            'lock_version' => 0,
        ]);

        $token = $this->getAuthToken($user);

        return ['user' => $user, 'role' => $role, 'token' => $token];
    }

    protected function getAuthToken(User $user, string $password = 'password123'): string
    {
        $response = $this->postJson('/api/v1/auth/login', [
            'login' => $user->username,
            'password' => $password,
        ]);

        return $response->json('data.token');
    }

    protected function authHeaders(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    public function test_admin_can_list_users(): void
    {
        $admin = $this->createAdmin();

        User::create([
            'name' => 'Test User',
            'username' => 'testuser',
            'password' => bcrypt('password123'),
            'role_id' => $admin['role']->id,
            'status' => UserStatus::ACTIVE,
            'lock_version' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/users');

        $response->assertStatus(200);
        $response->assertJsonCount(2, 'data');
    }

    public function test_admin_can_create_a_user(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/users', [
                'name' => 'New User',
                'username' => 'newuser',
                'email' => 'new@example.com',
                'phone' => '+201000000001',
                'password' => 'password123',
                'role_id' => $admin['role']->id,
                'status' => 'active',
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('users', ['username' => 'newuser']);
    }

    public function test_admin_cannot_create_user_with_duplicate_username(): void
    {
        $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($this->getAuthToken(User::where('username', 'admin')->first())))
            ->postJson('/api/v1/admin/users', [
                'name' => 'Duplicate',
                'username' => 'admin',
                'password' => 'password123',
                'role_id' => Role::where('is_admin', true)->first()->id,
            ]);

        $response->assertStatus(422);
    }

    public function test_admin_can_update_a_user(): void
    {
        $admin = $this->createAdmin();

        $user = User::create([
            'name' => 'Old Name',
            'username' => 'olduser',
            'password' => bcrypt('password123'),
            'role_id' => $admin['role']->id,
            'status' => UserStatus::ACTIVE,
            'lock_version' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/users/' . $user->id, [
                'name' => 'New Name',
                'lock_version' => $user->lock_version,
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'name' => 'New Name']);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'lock_version' => 1]);
    }

    public function test_update_fails_with_stale_lock_version(): void
    {
        $admin = $this->createAdmin();

        $user = User::create([
            'name' => 'Test',
            'username' => 'testuser',
            'password' => bcrypt('password123'),
            'role_id' => $admin['role']->id,
            'status' => UserStatus::ACTIVE,
            'lock_version' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/users/' . $user->id, [
                'name' => 'New Name',
                'lock_version' => 999,
            ]);

        $response->assertStatus(422);
    }

    public function test_admin_can_suspend_a_user(): void
    {
        $admin = $this->createAdmin();

        $user = User::create([
            'name' => 'To Suspend',
            'username' => 'tosuspend',
            'password' => bcrypt('password123'),
            'role_id' => $admin['role']->id,
            'status' => UserStatus::ACTIVE,
            'lock_version' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/users/' . $user->id . '/suspend');

        $response->assertStatus(200);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'status' => 'suspended']);
    }

    public function test_admin_can_activate_a_suspended_user(): void
    {
        $admin = $this->createAdmin();

        $user = User::create([
            'name' => 'To Activate',
            'username' => 'toactivate',
            'password' => bcrypt('password123'),
            'role_id' => $admin['role']->id,
            'status' => UserStatus::SUSPENDED,
            'lock_version' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/users/' . $user->id . '/activate');

        $response->assertStatus(200);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'status' => 'active']);
    }

    public function test_last_admin_cannot_be_suspended(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/users/' . $admin['user']->id . '/suspend');

        $response->assertStatus(422);
    }

    public function test_last_admin_cannot_be_deleted(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->deleteJson('/api/v1/admin/users/' . $admin['user']->id);

        $response->assertStatus(422);
    }

    public function test_non_admin_cannot_access_users_list(): void
    {
        $admin = $this->createAdmin();

        $regularRole = Role::create([
            'name' => 'staff',
            'is_admin' => false,
        ]);

        $regularUser = User::create([
            'name' => 'Staff',
            'username' => 'staff',
            'password' => bcrypt('password123'),
            'role_id' => $regularRole->id,
            'status' => UserStatus::ACTIVE,
            'lock_version' => 0,
        ]);

        $regularToken = $this->getAuthToken($regularUser);

        $response = $this->withHeaders($this->authHeaders($regularToken))
            ->getJson('/api/v1/admin/users');

        $response->assertStatus(403);
    }
}
