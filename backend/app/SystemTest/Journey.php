<?php

namespace App\SystemTest;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Artisan;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

abstract class Journey
{
    protected JourneyResult $result;

    public function __construct(protected string $name)
    {
        $this->result = new JourneyResult($name);
    }

    abstract public function run(): JourneyResult;

    protected function assertStatus(array $response, int $expected, string $step): void
    {
        $actual = $response['status'] ?? 500;
        if ($actual !== $expected) {
            $this->result->addFail([
                'journey' => $this->name,
                'step' => $step,
                'expected' => $expected,
                'actual' => $actual,
                'response' => $response['json'] ?? null,
                'request' => null,
            ]);
            return;
        }
        $this->result->addPass();
    }

    protected function runHttpCall(callable $call, string $step): array
    {
        try {
            $result = $call();

            if ($result instanceof \Illuminate\Http\Testing\TestResponse) {
                return [
                    'status' => $result->status(),
                    'json' => $result->json(),
                ];
            }

            return [
                'status' => $result->getStatusCode() ?? 200,
                'json' => json_decode($result->getContent(), true) ?? [],
            ];
        } catch (\Throwable $e) {
            $this->result->addFail([
                'journey' => $this->name,
                'step' => $step,
                'expected' => 'successful HTTP response',
                'actual' => 'exception: ' . $e->getMessage(),
                'response' => null,
                'request' => null,
            ]);

            return [
                'status' => 500,
                'json' => null,
            ];
        }
    }
}
