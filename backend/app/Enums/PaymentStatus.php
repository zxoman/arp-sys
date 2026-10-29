<?php

namespace App\Enums;

enum PaymentStatus: string
{
    case VALID = 'valid';
    case CANCELLED = 'cancelled';

    public function label(): string
    {
        return __("enums.payment_status.{$this->value}");
    }

    public static function allValues(): array
    {
        return array_column(self::cases(), 'value');
    }
}