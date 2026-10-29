<?php

namespace App\Enums;

enum BuildingActivity: string
{
    case RESIDENTIAL = 'residential';
    case ADMINISTRATIVE = 'administrative';
    case COMMERCIAL = 'commercial';
    case MEDICAL = 'medical';
    case HOTEL = 'hotel';

    public function label(): string
    {
        return __("enums.building_activity.{$this->value}");
    }

    public static function allValues(): array
    {
        return array_column(self::cases(), 'value');
    }
}
