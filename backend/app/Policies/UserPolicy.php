<?php

namespace App\Policies;

use App\Models\User;

class UserPolicy
{
    public function viewAny(User $user): bool
    {
        $user->load('role');

        return $user->hasPermission('users.manage');
    }

    public function view(User $user): bool
    {
        $user->load('role');

        return $user->hasPermission('users.manage');
    }

    public function create(User $user): bool
    {
        $user->load('role');

        return $user->hasPermission('users.manage');
    }

    public function update(User $user, User $target): bool
    {
        $user->load('role');

        return $user->hasPermission('users.manage');
    }

    public function delete(User $user, User $target): bool
    {
        $user->load('role');

        return $user->hasPermission('users.manage');
    }
}
