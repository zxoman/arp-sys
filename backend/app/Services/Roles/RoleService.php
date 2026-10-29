<?php

namespace App\Services\Roles;

use App\Models\Role;
use App\Models\RolePermission;
use App\Models\User;
use App\Enums\AuditAction;
use App\Enums\Permission;
use App\Services\Audit\AuditLogger;
use App\Support\Transactions\Operation;
use Illuminate\Validation\ValidationException;

class RoleService
{
    public function __construct(
        private Operation $operation,
        private AuditLogger $audit
    ) {
    }

    public function create(array $data, User $creator): Role
    {
        if (!$creator->hasPermission('roles.manage')) {
            $this->audit->logRejected(
                action: AuditAction::REJECTED_OPERATION->value,
                reason: 'Insufficient permissions: roles.manage required',
                entityType: 'roles',
            );

            throw ValidationException::withMessages([
                'roles' => __('auth.insufficient_permissions'),
            ]);
        }

        $role = Role::create([
            'name' => $data['name'],
            'display_name' => $data['display_name'] ?? null,
            'description' => $data['description'] ?? null,
            'is_admin' => $data['is_admin'] ?? false,
            'lock_version' => 0,
        ]);

        // Sync permissions
        $permissions = $data['permissions'] ?? [];
        $this->syncPermissions($role, $permissions, $creator);

        $this->audit->log(
            action: AuditAction::CREATE->value,
            entityType: 'roles',
            entityId: $role->id,
            newValues: $this->safeRoleArray($role),
            reason: 'Role created by ' . $creator->name,
        );

        return $role;
    }

    public function update(Role $role, array $data, User $editor, string $lockVersion): Role
    {
        if (!$editor->hasPermission('roles.manage')) {
            $this->audit->logRejected(
                action: AuditAction::REJECTED_OPERATION->value,
                reason: 'Insufficient permissions: roles.manage required',
                entityType: 'roles',
                entityId: $role->id,
            );

            throw ValidationException::withMessages([
                'roles' => __('auth.insufficient_permissions'),
            ]);
        }

        if ((string) $role->lock_version !== $lockVersion) {
            throw ValidationException::withMessages([
                'lock_version' => __('auth.stale_record'),
            ]);
        }

        $oldValues = $this->safeRoleArray($role);

        $role->fill(array_filter([
            'name' => $data['name'] ?? null,
            'display_name' => $data['display_name'] ?? null,
            'description' => $data['description'] ?? null,
            'is_admin' => $data['is_admin'] ?? null,
        ]));
        $role->lock_version = $role->lock_version + 1;
        $role->save();

        if (isset($data['permissions'])) {
            $this->syncPermissions($role, $data['permissions'], $editor);
        }

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'roles',
            entityId: $role->id,
            oldValues: $oldValues,
            newValues: $this->safeRoleArray($role),
            changedFields: array_keys(array_filter([
                'name' => $data['name'] ?? null,
                'is_admin' => $data['is_admin'] ?? null,
            ])),
            reason: 'Role updated by ' . $editor->name,
        );

        return $role;
    }

    public function delete(Role $role, User $actor): void
    {
        if (!$actor->hasPermission('roles.manage')) {
            throw ValidationException::withMessages([
                'roles' => __('auth.insufficient_permissions'),
            ]);
        }

        // Role linked to users cannot be deleted
        if ($role->users()->exists()) {
            throw ValidationException::withMessages([
                'roles' => __('auth.role_in_use'),
            ]);
        }

        $oldValues = $this->safeRoleArray($role);
        $role->delete();

        $this->audit->log(
            action: AuditAction::DELETE->value,
            entityType: 'roles',
            entityId: $role->id,
            oldValues: $oldValues,
            reason: 'Role deleted by ' . $actor->name,
        );
    }

    private function syncPermissions(Role $role, array $permissions, User $actor): void
    {
        // Validate all permissions exist in the enum
        $validPermissions = array_map(fn ($p) => $p->value, Permission::cases());
        $invalid = array_diff($permissions, $validPermissions);
        if (!empty($invalid)) {
            throw ValidationException::withMessages([
                'permissions' => __('auth.invalid_permissions', ['permissions' => implode(', ', $invalid)]),
            ]);
        }

        RolePermission::where('role_id', $role->id)->delete();

        foreach ($permissions as $permission) {
            RolePermission::create([
                'role_id' => $role->id,
                'permission' => $permission,
            ]);
        }

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'roles',
            entityId: $role->id,
            newValues: ['permissions' => $permissions],
            isAutomatic: true,
            reason: 'Permissions synced by ' . $actor->name,
        );
    }

    private function safeRoleArray(Role $role): array
    {
        return [
            'id' => $role->id,
            'name' => $role->name,
            'display_name' => $role->display_name,
            'is_admin' => $role->is_admin,
        ];
    }
}
