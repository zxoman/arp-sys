<?php

namespace App\Services\Users;

use App\Models\User;
use App\Enums\AuditAction;
use App\Enums\UserStatus;
use App\Services\Audit\AuditLogger;
use App\Support\Transactions\Operation;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class UserService
{
    public function __construct(
        private Operation $operation,
        private AuditLogger $audit
    ) {
    }

    public function create(array $data, User $creator): User
    {
        // Only admins can create users
        if (!$creator->hasPermission('users.manage')) {
            $this->audit->logRejected(
                action: AuditAction::REJECTED_OPERATION->value,
                reason: 'Insufficient permissions: users.manage required',
                entityType: 'users',
            );

            throw ValidationException::withMessages([
                'users' => __('auth.insufficient_permissions'),
            ]);
        }

        $user = User::create([
            'name' => $data['name'],
            'username' => $data['username'],
            'email' => $data['email'] ?? null,
            'phone' => $data['phone'] ?? null,
            'password' => Hash::make($data['password']),
            'role_id' => $data['role_id'],
            'status' => $data['status'] ?? UserStatus::ACTIVE,
            'created_by' => $creator->id,
            'lock_version' => 0,
        ]);

        $this->audit->log(
            action: AuditAction::CREATE->value,
            entityType: 'users',
            entityId: $user->id,
            newValues: $this->safeUserArray($user),
            reason: 'User created by ' . $creator->name,
        );

        return $user;
    }

    public function update(User $user, array $data, User $editor, string $lockVersion): User
    {
        if (!$editor->hasPermission('users.manage')) {
            $this->audit->logRejected(
                action: AuditAction::REJECTED_OPERATION->value,
                reason: 'Insufficient permissions: users.manage required',
                entityType: 'users',
                entityId: $user->id,
            );

            throw ValidationException::withMessages([
                'users' => __('auth.insufficient_permissions'),
            ]);
        }

        // Optimistic locking
        if ((string) $user->lock_version !== $lockVersion) {
            throw ValidationException::withMessages([
                'lock_version' => __('auth.stale_record'),
            ]);
        }

        $oldValues = $this->safeUserArray($user);

        $user->fill(array_filter([
            'name' => $data['name'] ?? null,
            'username' => $data['username'] ?? null,
            'email' => $data['email'] ?? null,
            'phone' => $data['phone'] ?? null,
            'role_id' => $data['role_id'] ?? null,
            'status' => $data['status'] ?? null,
        ]));

        if (isset($data['password'])) {
            $user->password = Hash::make($data['password']);
        }

        $user->lock_version = $user->lock_version + 1;
        $user->save();

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'users',
            entityId: $user->id,
            oldValues: $oldValues,
            newValues: $this->safeUserArray($user),
            changedFields: array_keys(array_filter([
                'name' => $data['name'] ?? null,
                'username' => $data['username'] ?? null,
                'email' => $data['email'] ?? null,
                'phone' => $data['phone'] ?? null,
                'role_id' => $data['role_id'] ?? null,
                'status' => $data['status'] ?? null,
            ])),
            reason: 'User updated by ' . $editor->name,
        );

        return $user;
    }

    public function suspend(User $user, User $actor): void
    {
        if (!$actor->hasPermission('users.manage')) {
            throw ValidationException::withMessages([
                'users' => __('auth.insufficient_permissions'),
            ]);
        }

        // Last remaining admin can never be suspended
        if ($user->role->is_admin && User::where('role_id', $user->role_id)
            ->where('status', 'active')
            ->where('id', '!=', $user->id)
            ->count() === 0) {
            throw ValidationException::withMessages([
                'users' => __('auth.last_admin_cannot_suspend'),
            ]);
        }

        $oldValues = $this->safeUserArray($user);
        $user->status = UserStatus::SUSPENDED;
        $user->lock_version = $user->lock_version + 1;
        $user->save();

        // Revoke all tokens immediately
        $user->tokens()->delete();

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'users',
            entityId: $user->id,
            oldValues: $oldValues,
            newValues: $this->safeUserArray($user),
            changedFields: ['status'],
            reason: 'User suspended by ' . $actor->name,
        );
    }

    public function activate(User $user, User $actor): void
    {
        if (!$actor->hasPermission('users.manage')) {
            throw ValidationException::withMessages([
                'users' => __('auth.insufficient_permissions'),
            ]);
        }

        $oldValues = $this->safeUserArray($user);
        $user->status = UserStatus::ACTIVE;
        $user->failed_login_attempts = 0;
        $user->locked_until = null;
        $user->lock_version = $user->lock_version + 1;
        $user->save();

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'users',
            entityId: $user->id,
            oldValues: $oldValues,
            newValues: $this->safeUserArray($user),
            changedFields: ['status'],
            reason: 'User activated by ' . $actor->name,
        );
    }

    public function delete(User $user, User $actor): void
    {
        if (!$actor->hasPermission('users.manage')) {
            throw ValidationException::withMessages([
                'users' => __('auth.insufficient_permissions'),
            ]);
        }

        // Last remaining admin can never be deleted
        if ($user->role->is_admin && User::where('role_id', $user->role_id)
            ->where('status', 'active')
            ->where('id', '!=', $user->id)
            ->count() === 0) {
            throw ValidationException::withMessages([
                'users' => __('auth.last_admin_cannot_delete'),
            ]);
        }

        $oldValues = $this->safeUserArray($user);
        $user->delete();

        $this->audit->log(
            action: AuditAction::DELETE->value,
            entityType: 'users',
            entityId: $user->id,
            oldValues: $oldValues,
            reason: 'User deleted by ' . $actor->name,
        );
    }

    public function resetPassword(User $user, string $newPassword, User $actor): void
    {
        if (!$actor->hasPermission('users.manage')) {
            throw ValidationException::withMessages([
                'users' => __('auth.insufficient_permissions'),
            ]);
        }

        $oldValues = $this->safeUserArray($user);
        $user->password = Hash::make($newPassword);
        $user->failed_login_attempts = 0;
        $user->locked_until = null;
        $user->lock_version = $user->lock_version + 1;
        $user->save();

        // Revoke all tokens on password reset
        $user->tokens()->delete();

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'users',
            entityId: $user->id,
            oldValues: $oldValues,
            newValues: $this->safeUserArray($user),
            changedFields: ['password', 'failed_login_attempts', 'locked_until'],
            reason: 'Password reset by ' . $actor->name,
        );
    }

    private function safeUserArray(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'username' => $user->username,
            'email' => $user->email,
            'phone' => $user->phone,
            'status' => $user->status?->value,
            'role_id' => $user->role_id,
            // password is intentionally omitted
        ];
    }
}
