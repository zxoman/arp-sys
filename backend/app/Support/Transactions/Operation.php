<?php

namespace App\Support\Transactions;

use App\Support\Clock\Clock;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Str;

class Operation
{
    private ConnectionInterface $db;
    private Clock $clock;
    private string $operationId;

    public function __construct(ConnectionInterface $db, Clock $clock)
    {
        $this->db = $db;
        $this->clock = $clock;
        $this->operationId = (string) Str::ulid();
    }

    public function id(): string
    {
        return $this->operationId;
    }

    public function run(callable $callback): mixed
    {
        return $this->db->transaction(function () use ($callback) {
            return $callback();
        });
    }

    public function now(): \DateTimeImmutable
    {
        return $this->clock->now();
    }
}
