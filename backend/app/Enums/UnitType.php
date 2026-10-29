<?php

namespace App\Enums;

enum UnitType: string
{
    case APARTMENT = 'apartment';
    case SHOP = 'shop';
    case WAREHOUSE = 'warehouse';
    case STUDIO = 'studio';

    public function label(): string
    {
        return __("enums.unit_type.{$this->value}");
    }

    public static function allValues(): array
    {
        return array_column(self::cases(), 'value');
    }
}
