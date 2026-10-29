<?php

namespace App\Enums;

enum BuildingType: string
{
    case BUILDING = 'building';
    case TOWER = 'tower';
    case HOUSE = 'house';
    case OFFICE_BUILDING = 'office_building';

    public function label(): string
    {
        return __("enums.building_type.{$this->value}");
    }

    public static function labels(): array
    {
        return [
            self::BUILDING->value => __('enums.building_type.building'),
            self::TOWER->value => __('enums.building_type.tower'),
            self::HOUSE->value => __('enums.building_type.house'),
            self::OFFICE_BUILDING->value => __('enums.building_type.office_building'),
        ];
    }
}
