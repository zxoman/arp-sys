<?php

namespace App\Enums;

/**
 * What a unit is offered for. `both` keeps the previous behaviour (no restriction): sale vs rent is
 * only decided at contract time.
 */
enum UnitPurpose: string
{
    case SALE = 'sale';
    case RENT = 'rent';
    case BOTH = 'both';

    public function label(): string
    {
        return __("enums.unit_purpose.{$this->value}");
    }

    /** The unit can be sold (sale | both). */
    public function offersSale(): bool
    {
        return $this !== self::RENT;
    }

    /** The unit can be rented (rent | both). */
    public function offersRent(): bool
    {
        return $this !== self::SALE;
    }

    public static function allValues(): array
    {
        return array_column(self::cases(), 'value');
    }

    public static function labels(): array
    {
        return [
            self::SALE->value => __('enums.unit_purpose.sale'),
            self::RENT->value => __('enums.unit_purpose.rent'),
            self::BOTH->value => __('enums.unit_purpose.both'),
        ];
    }
}
