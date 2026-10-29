<?php

namespace App\Services\Auth;

use App\Models\User;
use App\Enums\UserStatus;
use App\Services\Audit\AuditLogger;
use App\Support\Transactions\Operation;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class LoginService
{
    private const MAX_FAILED_ATTEMPTS = 5;
    private const LOCKOUT_MINUTES = 15;

    public function __construct(
        private Operation $operation,
        private AuditLogger $audit
    ) {
    }

    public function login(string $login, string $password, string $ip, string $userAgent): array
    {
        $user = User::where(function ($q) use ($login) {
            $q->where('username', $login)
              ->orWhere('email', $login);
        })->first();

        if (!$user || !Hash::check($password, $user->password)) {
            $this->recordFailedLogin($user?->id, $login, $ip, $userAgent);

            throw ValidationException::withMessages([
                'login' => __('auth.failed'),
            ]);
        }

        if ($user->status !== UserStatus::ACTIVE) {
        $this->audit->log(
            action: \App\Enums\AuditAction::LOGIN_FAILED->value,
            entityType: 'users',
            entityId: $user->id,
            reason: 'Account is not active: ' . $user->status->value,
        );

            throw ValidationException::withMessages([
                'login' => __('auth.account_inactive'),
            ]);
        }

        if ($user->isLocked()) {
        $this->audit->log(
            action: \App\Enums\AuditAction::LOGIN_FAILED->value,
            entityType: 'users',
            entityId: $user->id,
            reason: 'Account is locked until ' . $user->locked_until,
        );

            throw ValidationException::withMessages([
                'login' => __('auth.account_locked'),
            ]);
        }

        // Clear failed attempts on successful login
        $user->failed_login_attempts = 0;
        $user->locked_until = null;
        $user->last_login_at = $this->operation->now();
        $user->save();

        // Revoke all existing tokens for this user (single session)
        $user->tokens()->delete();

        $token = $user->createToken('auth_token')->plainTextToken;

        $this->audit->log(
            action: \App\Enums\AuditAction::LOGIN->value,
            entityType: 'users',
            entityId: $user->id,
            reason: 'Successful login',
        );

        return [
            'token' => $token,
            'user' => $user,
        ];
    }

    public function logout(User $user): void
    {
        $user->tokens()->delete();

        $this->audit->log(
            action: \App\Enums\AuditAction::LOGOUT->value,
            entityType: 'users',
            entityId: $user->id,
        );
    }

    private function recordFailedLogin(?int $userId, string $login, string $ip, string $userAgent): void
    {
        if ($userId) {
            $user = User::find($userId);
            $user->failed_login_attempts += 1;

            if ($user->failed_login_attempts >= self::MAX_FAILED_ATTEMPTS) {
                $user->locked_until = $this->operation->now()->addMinutes(self::LOCKOUT_MINUTES);
            }

            $user->save();
        }

        $this->audit->log(
            action: \App\Enums\AuditAction::LOGIN_FAILED->value,
            entityType: 'users',
            entityId: $userId,
            reason: 'Invalid credentials for login: ' . $login,
        );
    }
}
