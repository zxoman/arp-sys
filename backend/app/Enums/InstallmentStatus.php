<?php

namespace App\Enums;

enum InstallmentStatus: string
{
    case DUE = 'due';
    case PARTIALLY_PAID = 'partially_paid';
    case PAID = 'paid';
    /** Set only when the contract itself is cancelled: installments are never deleted. */
    case CANCELLED = 'cancelled';

    public function label(): string
    {
        return __("enums.installment_status.{$this->value}");
    }

    public static function allValues(): array
    {
        return array_column(self::cases(), 'value');
    }
}