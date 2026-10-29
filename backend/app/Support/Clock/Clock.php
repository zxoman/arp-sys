<?php

namespace App\Support\Clock;

use Carbon\CarbonInterface;

interface Clock
{
    public function now(): \DateTimeImmutable;

    public function today(): \DateTimeImmutable;
}
