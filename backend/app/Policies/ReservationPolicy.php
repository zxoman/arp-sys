<?php

namespace App\Policies;

use App\Models\Reservation;
use App\Models\User;

class ReservationPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('reservations.view');
    }

    public function view(User $user, Reservation $reservation): bool
    {
        return $user->hasPermission('reservations.view');
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('reservations.create');
    }

    public function update(User $user, Reservation $reservation): bool
    {
        return $user->hasPermission('reservations.update');
    }

    public function delete(User $user, Reservation $reservation): bool
    {
        return $user->hasPermission('reservations.delete');
    }

    public function cancel(User $user, Reservation $reservation): bool
    {
        return $user->hasPermission('reservations.cancel');
    }

    public function convert(User $user, Reservation $reservation): bool
    {
        return $user->hasPermission('reservations.convert');
    }
}