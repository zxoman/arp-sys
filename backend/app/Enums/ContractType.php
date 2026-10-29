<?php

namespace App\Enums;

enum ContractType: string
{
    case SALE = 'sale';
    case RENT = 'rent';

    public function label(): string
    {
        return __("enums.contract_type.{$this->value}");
    }

    public static function allValues(): array
    {
        return array_column(self::cases(), 'value');
    }
}