<?php

namespace App\Support\Clock;

use Carbon\Carbon;

class FrozenClock implements Clock
{
    private \DateTimeImmutable $time;

    public function __construct(\DateTimeImmutable $time)
    {
        $this->time = $time;
        Carbon::setTestNow($time);
    }

    public static function parse(string $time): self
    {
        return new self(new \DateTimeImmutable($time));
    }

    public function now(): \DateTimeImmutable
    {
        return $this->time;
    }

    public function today(): \DateTimeImmutable
    {
        return $this->time->setTime(0, 0, 0);
    }

    public function advance(\DateInterval $interval): void
    {
        $this->time = $this->time->add($interval);
        Carbon::setTestNow($this->time);
    }
}
