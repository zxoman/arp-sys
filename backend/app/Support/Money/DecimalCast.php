<?php

namespace App\Support\Money;

use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;

trait DecimalCast
{
    protected function castMoneyAttribute(string $attribute): Attribute
    {
        return Attribute::make(
            get: fn (mixed $value) => $value === null ? null : (string) $value,
            set: fn (mixed $value) => $value === null ? null : (string) $value,
        );
    }
}
