<?php

namespace App\SystemTest;

class JourneyResult
{
    public string $name;
    public int $passed = 0;
    public int $failed = 0;
    public int $total = 0;
    public float $duration = 0;
    public array $failures = [];

    public function __construct(string $name)
    {
        $this->name = $name;
    }

    public function addPass(): void
    {
        $this->passed++;
        $this->total++;
    }

    public function addFail(array $failure): void
    {
        $this->failed++;
        $this->total++;
        $this->failures[] = $failure;
    }
}
