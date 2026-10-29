<?php

namespace App\Support\Clock;

use Carbon\Carbon;

class SystemClock implements Clock
{
    public function now(): \DateTimeImmutable
    {
        return Carbon::now()->toImmutable();
    }

    public function today(): \DateTimeImmutable
    {
        return Carbon::today()->toImmutable();
    }
}
