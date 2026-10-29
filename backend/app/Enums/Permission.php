<?php

namespace App\Enums;

enum Permission: string
{
    case BUILDINGS_VIEW = 'buildings.view';
    case BUILDINGS_CREATE = 'buildings.create';
    case BUILDINGS_UPDATE = 'buildings.update';
    case BUILDINGS_DELETE = 'buildings.delete';

    case UNITS_VIEW = 'units.view';
    case UNITS_CREATE = 'units.create';
    case UNITS_UPDATE = 'units.update';
    case UNITS_DELETE = 'units.delete';

    case CLIENTS_VIEW = 'clients.view';
    case CLIENTS_CREATE = 'clients.create';
    case CLIENTS_UPDATE = 'clients.update';
    case CLIENTS_DELETE = 'clients.delete';

    case RESERVATIONS_VIEW = 'reservations.view';
    case RESERVATIONS_CREATE = 'reservations.create';
    case RESERVATIONS_UPDATE = 'reservations.update';
    case RESERVATIONS_DELETE = 'reservations.delete';
    case RESERVATIONS_CANCEL = 'reservations.cancel';
    case RESERVATIONS_CONVERT = 'reservations.convert';

    case CONTRACTS_VIEW = 'contracts.view';
    case CONTRACTS_CREATE = 'contracts.create';
    case CONTRACTS_UPDATE = 'contracts.update';
    case CONTRACTS_DELETE = 'contracts.delete';
    case CONTRACTS_CANCEL = 'contracts.cancel';

    case PAYMENTS_CREATE = 'payments.create';
    case PAYMENTS_CANCEL = 'payments.cancel';

    case PRICES_OVERRIDE_RESERVATION = 'prices.override_reservation';
    case CONTRACTS_BACKDATE_SCHEDULE = 'contracts.backdate_schedule';

    case REPORTS_CUSTOMER_STATEMENT = 'reports.customer_statement';
    case REPORTS_BUILDING = 'reports.building';
    case REPORTS_UNIT = 'reports.unit';
    case REPORTS_SALES = 'reports.sales';
    case REPORTS_DAILY_INVENTORY = 'reports.daily_inventory';
    case REPORTS_EXPORT = 'reports.export';

    case SETTINGS_VIEW = 'settings.view';
    case SETTINGS_UPDATE = 'settings.update';

    case AUDIT_VIEW = 'audit.view';
    case USERS_MANAGE = 'users.manage';
    case ROLES_MANAGE = 'roles.manage';
    case BACKUPS_MANAGE = 'backups.manage';
    case BACKUPS_DOWNLOAD = 'backups.download';

    public static function all(): array
    {
        return array_column(self::cases(), 'value');
    }

    public function entity(): string
    {
        return explode('.', $this->value)[0];
    }

    public function action(): string
    {
        return explode('.', $this->value)[1];
    }

    public function label(): string
    {
        return __("permissions.{$this->value}");
    }

    public static function adminPermissions(): array
    {
        return self::all();
    }
}
