<?php

namespace App\SystemTest\Journeys;

use App\SystemTest\Journey;
use App\SystemTest\JourneyResult;

/** Settings (stored in the database), users/roles, and the audit log the other journeys feed. */
class AdminJourney extends Journey
{
    public function __construct()
    {
        parent::__construct('Settings, users & logs');
    }

    public function run(): JourneyResult
    {
        if (! $this->login()) {
            return $this->result;
        }

        // --- Project settings live in the database -----------------------------------
        $this->expect($this->get('/api/v1/admin/settings'), 200, 'read settings');

        $saved = $this->put('/api/v1/admin/settings', [
            'project_name' => 'مشروع الاختبار',
            'project_address' => 'القاهرة الجديدة',
            'company_name' => 'شركة الاختبار',
            'company_phone' => '0225550190',
            'show_company_logo' => true,
            'show_our_logo' => false,
            'developer_url' => 'https://example.com',
        ]);
        $this->expect($saved, 200, 'save settings', 'data.project_name', 'مشروع الاختبار');
        $this->expect($saved, 200, 'booleans round-trip', 'data.show_our_logo', false);

        // Read back in a *different* request: proves it is persisted, not echoed.
        $reread = $this->get('/api/v1/admin/settings');
        $this->expect($reread, 200, 'settings survive a new request', 'data.project_name', 'مشروع الاختبار');
        $this->expect($reread, 200, 'address persisted', 'data.project_address', 'القاهرة الجديدة');

        // --- Users and roles ---------------------------------------------------------
        $roles = $this->get('/api/v1/admin/roles?per_page=100');
        $this->expect($roles, 200, 'list roles');
        $roleId = (int) data_get($roles['json'], 'data.0.id');
        $this->assert($roleId > 0, true, 'at least one role exists');

        $created = $this->post('/api/v1/admin/users', [
            'name' => 'مستخدم الاختبار',
            'username' => 'systemtest',
            'email' => 'systemtest@example.com',
            'phone' => '01011112222',
            'password' => 'Str0ngPassw0rd!',
            'role_id' => $roleId,
        ]);
        if (! $this->expect($created, 201, 'create user')) {
            return $this->result;
        }
        $userId = (int) data_get($created['json'], 'data.id');

        // A duplicate username is refused.
        $this->expect($this->post('/api/v1/admin/users', [
            'name' => 'مكرر',
            'username' => 'systemtest',
            'password' => 'Str0ngPassw0rd!',
            'role_id' => $roleId,
        ]), 422, 'duplicate username is refused');

        $this->expect($this->get('/api/v1/admin/users?search=systemtest'), 200, 'search users', 'meta.total', 1);

        $lockVersion = (int) data_get($created['json'], 'data.lock_version');
        $updated = $this->put("/api/v1/admin/users/{$userId}", [
            'name' => 'مستخدم الاختبار (معدل)',
            'lock_version' => $lockVersion,
        ]);
        $this->expect($updated, 200, 'update user', 'data.name', 'مستخدم الاختبار (معدل)');

        // A stale lock version is rejected (optimistic locking).
        $this->expect($this->put("/api/v1/admin/users/{$userId}", [
            'name' => 'قديم',
            'lock_version' => $lockVersion,
        ]), 422, 'stale lock_version is refused');

        $this->expect($this->post("/api/v1/admin/users/{$userId}/suspend"), 200, 'suspend user');
        $this->expect($this->get("/api/v1/admin/users/{$userId}"), 200, 'suspended status is stored', 'data.status', 'suspended');
        $this->expect($this->post("/api/v1/admin/users/{$userId}/activate"), 200, 'activate user');
        $this->expect($this->post("/api/v1/admin/users/{$userId}/reset-password", ['new_password' => 'An0therPassw0rd!']), 200, 'reset a password');
        $this->expect($this->delete("/api/v1/admin/users/{$userId}"), 200, 'delete user');

        // --- Audit log ---------------------------------------------------------------
        $logs = $this->get('/api/v1/admin/audit-logs');
        $this->expect($logs, 200, 'audit log is readable');
        $this->assert((int) data_get($logs['json'], 'meta.total') > 0, true, 'the audit log has entries');

        $this->expect($this->get('/api/v1/admin/audit-logs?action=update'), 200, 'filter the log by action');
        $this->expect($this->get('/api/v1/admin/audit-logs?entity_type=settings'), 200, 'filter the log by entity');

        $first = (int) data_get($logs['json'], 'data.0.id');
        $this->expect($this->get("/api/v1/admin/audit-logs/{$first}"), 200, 'open one log entry');

        return $this->result;
    }
}
