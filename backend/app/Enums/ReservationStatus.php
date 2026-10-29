<?php

namespace App\Enums;

enum ReservationStatus: string
{
    case ACTIVE = 'active';
    case CONVERTED = 'converted';
    case CANCELLED = 'cancelled';

    public function label(): string
    {
        return __("enums.reservation_status.{$this->value}");
    }

    public static function allValues(): array
    {
        return array_column(self::cases(), 'value');
    }
}