<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Enums\UserStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SettingsTest extends TestCase
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
        return ['Authorization' => 'Bearer ' . $token];
    }

    public function test_admin_can_view_project_settings(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/settings');

        $response->assertStatus(200)
            ->assertJsonStructure(['data' => ['project_name', 'project_address']]);
    }

    public function test_admin_can_update_project_settings(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/settings', [
                'project_name' => 'مشروع النخيل',
                'project_address' => 'القاهرة الجديدة - التجمع الخامس',
            ]);

        $response->assertStatus(200)
            ->assertJsonPath('data.project_name', 'مشروع النخيل')
            ->assertJsonPath('data.project_address', 'القاهرة الجديدة - التجمع الخامس');

        $this->assertDatabaseHas('settings', [
            'key' => 'project_name',
            'value' => 'مشروع النخيل',
        ]);
        $this->assertDatabaseHas('settings', [
            'key' => 'project_address',
            'value' => 'القاهرة الجديدة - التجمع الخامس',
        ]);

        // Reading it back returns the stored values.
        $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/settings')
            ->assertStatus(200)
            ->assertJsonPath('data.project_name', 'مشروع النخيل');
    }

    public function test_project_name_cannot_exceed_max_length(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/settings', [
                'project_name' => str_repeat('ا', 256),
            ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors('project_name');
    }

    public function test_user_without_permission_cannot_update_settings(): void
    {
        $this->createAdmin();

        $staffRole = Role::create([
            'name' => 'staff',
            'is_admin' => false,
        ]);

        $staff = User::create([
            'name' => 'Staff',
            'username' => 'staff',
            'password' => bcrypt('password123'),
            'role_id' => $staffRole->id,
            'status' => UserStatus::ACTIVE,
            'lock_version' => 0,
        ]);

        $staffToken = $this->getAuthToken($staff);

        $this->withHeaders($this->authHeaders($staffToken))
            ->putJson('/api/v1/admin/settings', ['project_name' => 'X'])
            ->assertStatus(403);
    }
}
