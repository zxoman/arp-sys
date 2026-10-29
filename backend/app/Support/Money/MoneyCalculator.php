<?php

namespace App\Support\Money;

use Brick\Math\RoundingMode;

class MoneyCalculator
{
    public static function multiplyAreaByPricePerMeter(string $area, string $pricePerMeter): string
    {
        return Money::fromString($area)
            ->multiply($pricePerMeter)
            ->toString();
    }

    public static function installmentAmount(string $price, string $agreedDownPayment, int $installmentsCount): array
    {
        if ($installmentsCount <= 0) {
            return ['amount' => '0', 'remainder' => '0'];
        }

        $price = Money::fromString($price);
        $downPayment = Money::fromString($agreedDownPayment);
        $remainder = $price->subtract($downPayment);

        $perInstallment = $remainder->divide((string) $installmentsCount);

        return [
            'amount' => $perInstallment->toString(),
            'remainder' => $remainder->toString(),
        ];
    }

    public static function lastInstallmentAmount(string $amount, int $installmentsCount): string
    {
        if ($installmentsCount <= 0) {
            return '0';
        }

        $totalAmount = Money::fromString($amount)->multiply((string) $installmentsCount);

        return $totalAmount->toString();
    }

    public static function sumPayments(array $amounts): string
    {
        $sum = Money::zero();
        foreach ($amounts as $amount) {
            $sum = $sum->add(Money::fromString($amount));
        }

        return $sum->toString();
    }

    public static function remaining(string $total, string $paid): string
    {
        return Money::fromString($total)->subtract(Money::fromString($paid))->toString();
    }
}
