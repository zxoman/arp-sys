<?php

namespace App\Policies;

use App\Models\Building;
use App\Models\User;

class BuildingPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('buildings.view');
    }

    public function view(User $user, Building $building): bool
    {
        return $user->hasPermission('buildings.view');
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('buildings.create');
    }

    public function update(User $user, Building $building): bool
    {
        return $user->hasPermission('buildings.update');
    }

    public function delete(User $user, Building $building): bool
    {
        return $user->hasPermission('buildings.delete');
    }
}
