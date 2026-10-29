<?php

namespace App\Support\Money;

use Brick\Math\BigDecimal;
use Brick\Math\Exception\DivisionByZeroException;
use Brick\Math\RoundingMode;

class Money
{
    private BigDecimal $amount;

    private function __construct(BigDecimal $amount)
    {
        $this->amount = $amount;
    }

    public static function fromString(string $amount): self
    {
        return new self(BigDecimal::of($amount));
    }

    public static function fromInt(int $amount): self
    {
        return new self(BigDecimal::of($amount));
    }

    public static function zero(): self
    {
        return new self(BigDecimal::zero());
    }

    public static function fromMinorUnits(int $minorUnits, int $scale = 2): self
    {
        return new self(BigDecimal::of($minorUnits)->scaleByPowerOfTen(-$scale));
    }

    public function add(self $other): self
    {
        return new self($this->amount->plus($other->amount));
    }

    public function subtract(self $other): self
    {
        return new self($this->amount->minus($other->amount));
    }

    public function multiply(string $multiplier): self
    {
        return new self($this->amount->multipliedBy(BigDecimal::of($multiplier)));
    }

    public function divide(string $divisor, int $scale = 2): self
    {
        try {
            return new self($this->amount->dividedBy(BigDecimal::of($divisor), $scale, RoundingMode::HALF_UP));
        } catch (DivisionByZeroException $e) {
            return self::zero();
        }
    }

    public function toString(int $scale = 2): string
    {
        return $this->amount->toScale($scale, RoundingMode::HALF_UP)->toString();
    }

    public function toFloat(): float
    {
        return $this->amount->floatValue();
    }

    public function isZero(): bool
    {
        return $this->amount->isZero();
    }

    public function isPositive(): bool
    {
        return $this->amount->isPositive();
    }

    public function isNegative(): bool
    {
        return $this->amount->isNegative();
    }

    public function greaterThan(self $other): bool
    {
        return $this->amount->compareTo($other->amount) > 0;
    }

    public function greaterThanOrEqual(self $other): bool
    {
        return $this->amount->compareTo($other->amount) >= 0;
    }

    public function lessThan(self $other): bool
    {
        return $this->amount->compareTo($other->amount) < 0;
    }

    public function lessThanOrEqual(self $other): bool
    {
        return $this->amount->compareTo($other->amount) <= 0;
    }

    public function equal(self $other): bool
    {
        return $this->amount->compareTo($other->amount) === 0;
    }

    public function __toString(): string
    {
        return $this->toString();
    }
}
