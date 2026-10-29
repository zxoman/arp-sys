<?php

namespace App\Enums;

enum PaymentMethod: string
{
    case CASH = 'cash';
    case BANK_TRANSFER = 'bank_transfer';
    case CHEQUE = 'cheque';
    case VODAFONE_CASH = 'vodafone_cash';
    case INSTAPAY = 'instapay';
    case OTHER = 'other';

    public function label(): string
    {
        return __("enums.payment_method.{$this->value}");
    }

    public static function allValues(): array
    {
        return array_column(self::cases(), 'value');
    }
}
