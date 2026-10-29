<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Enums\Permission;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RoleTest extends TestCase
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
            'password' => bcrypt('password123'),
            'role_id' => $role->id,
            'status' => 'active',
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

    public function test_admin_can_list_roles(): void
    {
        $admin = $this->createAdmin();

        Role::create([
            'name' => 'staff',
            'is_admin' => false,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/roles');

        $response->assertStatus(200);
        $response->assertJsonCount(2, 'data');
    }

    public function test_admin_can_create_a_role_with_permissions(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/roles', [
                'name' => 'staff',
                'display_name' => 'موظف',
                'is_admin' => false,
                'permissions' => ['units.view', 'clients.view'],
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('role_permissions', [
            'permission' => 'units.view',
        ]);
    }

    public function test_admin_can_update_a_role(): void
    {
        $admin = $this->createAdmin();

        $role = Role::create([
            'name' => 'staff',
            'is_admin' => false,
            'lock_version' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/roles/' . $role->id, [
                'name' => 'staff_updated',
                'lock_version' => $role->lock_version,
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('roles', ['id' => $role->id, 'name' => 'staff_updated']);
    }

    public function test_role_update_fails_with_stale_lock_version(): void
    {
        $admin = $this->createAdmin();

        $role = Role::create([
            'name' => 'staff',
            'is_admin' => false,
            'lock_version' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/roles/' . $role->id, [
                'name' => 'staff_updated',
                'lock_version' => 999,
            ]);

        $response->assertStatus(422);
    }

    public function test_admin_can_delete_a_role_not_linked_to_users(): void
    {
        $admin = $this->createAdmin();

        $role = Role::create([
            'name' => 'deletable',
            'is_admin' => false,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->deleteJson('/api/v1/admin/roles/' . $role->id);

        $response->assertStatus(200);
        $this->assertSoftDeleted($role);
    }

    public function test_role_linked_to_users_cannot_be_deleted(): void
    {
        $admin = $this->createAdmin();

        $role = Role::create([
            'name' => 'linked',
            'is_admin' => false,
        ]);

        User::create([
            'name' => 'Linked User',
            'username' => 'linkeduser',
            'password' => bcrypt('password123'),
            'role_id' => $role->id,
            'status' => 'active',
            'lock_version' => 0,
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->deleteJson('/api/v1/admin/roles/' . $role->id);

        $response->assertStatus(422);
    }

    public function test_permissions_endpoint_returns_all_fixed_permissions(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/roles/permissions');

        $response->assertStatus(200);
        $permissions = $response->json('data');
        $this->assertGreaterThan(0, count($permissions));
        $this->assertContains('units.view', array_column($permissions, 'value'));
    }

    public function test_admin_role_has_all_permissions(): void
    {
        $admin = $this->createAdmin();

        $this->assertTrue($admin['user']->hasPermission('users.manage'));
        $this->assertTrue($admin['user']->hasPermission('roles.manage'));
        $this->assertTrue($admin['user']->hasPermission('audit.view'));
        $this->assertTrue($admin['user']->hasPermission('clients.create'));
    }
}
