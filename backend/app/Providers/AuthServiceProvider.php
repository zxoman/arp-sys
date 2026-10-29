<?php

namespace App\Providers;

use App\Models\AuditLog;
use App\Models\Building;
use App\Models\Client;
use App\Models\Contract;
use App\Models\Reservation;
use App\Models\Role;
use App\Models\Unit;
use App\Models\User;
use App\Policies\AuditLogPolicy;
use App\Policies\BuildingPolicy;
use App\Policies\ClientPolicy;
use App\Policies\ContractPolicy;
use App\Policies\ReservationPolicy;
use App\Policies\RolePolicy;
use App\Policies\UnitPolicy;
use App\Policies\UserPolicy;
use Illuminate\Foundation\Support\Providers\AuthServiceProvider as ServiceProvider;
use Illuminate\Support\Facades\Gate;

class AuthServiceProvider extends ServiceProvider
{
    protected $policies = [
        User::class => UserPolicy::class,
        Role::class => RolePolicy::class,
        AuditLog::class => AuditLogPolicy::class,
        Building::class => BuildingPolicy::class,
        Unit::class => UnitPolicy::class,
        Client::class => ClientPolicy::class,
        Reservation::class => ReservationPolicy::class,
        Contract::class => ContractPolicy::class,
    ];

    /**
     * Register any authentication / authorization services.
     */
    public function boot(): void
    {
        $this->registerPolicies();

        Gate::define('manage-users', fn (User $user) => $user->hasPermission('users.manage'));
        Gate::define('manage-roles', fn (User $user) => $user->hasPermission('roles.manage'));
        Gate::define('view-audit', fn (User $user) => $user->hasPermission('audit.view'));
        Gate::define('settings.view', fn (User $user) => $user->hasPermission('settings.view'));
        Gate::define('settings.update', fn (User $user) => $user->hasPermission('settings.update'));
        Gate::define('contracts.create', fn (User $user) => $user->hasPermission('contracts.create'));
        Gate::define('contracts.update', fn (User $user) => $user->hasPermission('contracts.update'));
        Gate::define('contracts.cancel', fn (User $user) => $user->hasPermission('contracts.cancel'));
        Gate::define('contracts.view', fn (User $user) => $user->hasPermission('contracts.view'));
        Gate::define('reports.customer_statement', fn (User $user) => $user->hasPermission('reports.customer_statement'));
        Gate::define('reports.building', fn (User $user) => $user->hasPermission('reports.building'));
        Gate::define('reports.unit', fn (User $user) => $user->hasPermission('reports.unit'));
        Gate::define('reports.sales', fn (User $user) => $user->hasPermission('reports.sales'));
        Gate::define('reports.daily_inventory', fn (User $user) => $user->hasPermission('reports.daily_inventory'));
        Gate::define('reports.export', fn (User $user) => $user->hasPermission('reports.export'));
    }
}
