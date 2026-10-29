<?php

namespace App\Policies;

use App\Models\Contract;
use App\Models\User;

class ContractPolicy
{
    public function viewAny(User $user): bool
    {
        $user->load('role');

        return $user->hasPermission('contracts.view');
    }

    public function view(User $user, Contract $contract): bool
    {
        $user->load('role');

        return $user->hasPermission('contracts.view');
    }

    public function create(User $user): bool
    {
        $user->load('role');

        return $user->hasPermission('contracts.create');
    }

    public function update(User $user, Contract $contract): bool
    {
        $user->load('role');

        return $user->hasPermission('contracts.update');
    }

    public function delete(User $user, Contract $contract): bool
    {
        $user->load('role');

        return $user->hasPermission('contracts.delete');
    }

    public function cancel(User $user, Contract $contract): bool
    {
        $user->load('role');

        return $user->hasPermission('contracts.cancel');
    }
}