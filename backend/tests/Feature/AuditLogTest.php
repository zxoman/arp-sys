<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Role;
use App\Models\User;
use App\Enums\AuditAction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditLogTest extends TestCase
{
    use RefreshDatabase;

    protected function createAdmin(): array
    {
        $role = Role::create([
            'name' => 'admin',
            'is_admin' => true,
        ]);

        $user = User::create([
            'name' => 'Admin',
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

    public function test_audit_log_records_create_operation(): void
    {
        $admin = $this->createAdmin();

        AuditLog::create([
            'user_id' => $admin['user']->id,
            'action' => AuditAction::CREATE,
            'entity_type' => 'roles',
            'entity_id' => 1,
            'operation_id' => 'op123',
            'occurred_at' => now(),
        ]);

        $this->assertDatabaseHas('audit_logs', [
            'action' => AuditAction::CREATE->value,
            'entity_type' => 'roles',
        ]);
    }

    public function test_audit_log_cannot_be_updated(): void
    {
        $this->createAdmin();

        $log = AuditLog::create([
            'user_id' => 1,
            'action' => AuditAction::CREATE,
            'entity_type' => 'test',
            'operation_id' => 'test123',
            'occurred_at' => now(),
        ]);

        try {
            $log->update(['action' => AuditAction::UPDATE]);
            $this->fail('Expected exception on audit log update');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('append-only', $e->getMessage());
        }
    }

    public function test_audit_log_cannot_be_deleted(): void
    {
        $this->createAdmin();

        $log = AuditLog::create([
            'user_id' => 1,
            'action' => AuditAction::CREATE,
            'entity_type' => 'test',
            'operation_id' => 'test123',
            'occurred_at' => now(),
        ]);

        try {
            $log->delete();
            $this->fail('Expected exception on audit log delete');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('append-only', $e->getMessage());
        }
    }

    public function test_admin_can_view_audit_logs(): void
    {
        $admin = $this->createAdmin();

        AuditLog::create([
            'user_id' => $admin['user']->id,
            'action' => AuditAction::LOGIN,
            'entity_type' => 'users',
            'entity_id' => $admin['user']->id,
            'operation_id' => 'op123',
            'occurred_at' => now(),
        ]);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/audit-logs');

        $response->assertStatus(200);
        $this->assertGreaterThanOrEqual(1, count($response->json('data')));
    }

    public function test_non_admin_cannot_view_audit_logs(): void
    {
        $this->createAdmin();

        $regularUser = User::create([
            'name' => 'Regular',
            'username' => 'regular',
            'password' => bcrypt('password123'),
            'status' => 'active',
            'lock_version' => 0,
        ]);

        $regularToken = $this->getAuthToken($regularUser);

        $response = $this->withHeaders($this->authHeaders($regularToken))
            ->getJson('/api/v1/admin/audit-logs');

        $response->assertStatus(403);
    }
}
