<?php

namespace App\SystemTest;

use Illuminate\Support\Facades\Http;

/**
 * Base for the end-to-end journeys.
 *
 * The journeys talk to the real HTTP stack through Laravel's HTTP client, so routing, middleware,
 * Sanctum, policies, validation and the audit log are all exercised — not just the services. They run
 * against a freshly migrated database (see `SystemTest`), never against live data (see `SafetyGuard`).
 */
abstract class Journey
{
    protected JourneyResult $result;

    /** Bearer token of the signed-in admin. */
    protected ?string $token = null;

    /** First failure's request/response, replayed in the report to make it debuggable. */
    protected array $context = [];

    public function __construct(protected string $name)
    {
        $this->result = new JourneyResult($name);
    }

    abstract public function run(): JourneyResult;

    protected function headers(): array
    {
        return array_filter([
            'Accept' => 'application/json',
            'Accept-Language' => 'ar',
            'Authorization' => $this->token ? 'Bearer '.$this->token : null,
        ]);
    }

    protected function get(string $path): array
    {
        return $this->call('get', $path);
    }

    protected function post(string $path, array $body = []): array
    {
        return $this->call('post', $path, $body);
    }

    protected function put(string $path, array $body = []): array
    {
        return $this->call('put', $path, $body);
    }

    protected function delete(string $path): array
    {
        return $this->call('delete', $path);
    }

    /** One HTTP round trip. Returns `['status' => int, 'json' => array]`. */
    protected function call(string $method, string $path, array $body = []): array
    {
        $base = rtrim((string) env('SYSTEM_TEST_BASE_URL', 'http://127.0.0.1:8000'), '/');
        $url = $base.(str_starts_with($path, '/') ? $path : '/'.$path);

        try {
            $pending = Http::withHeaders($this->headers())->timeout(30);
            $response = match ($method) {
                'get' => $pending->get($url),
                'post' => $pending->post($url, $body),
                'put' => $pending->put($url, $body),
                'delete' => $pending->delete($url, $body),
                default => throw new \InvalidArgumentException("Unsupported method {$method}"),
            };

            return [
                'status' => $response->status(),
                'json' => (array) ($response->json() ?? []),
            ];
        } catch (\Throwable $e) {
            return [
                'status' => 0,
                'json' => ['exception' => $e->getMessage()],
            ];
        }
    }

    /** Asserts the status (and, when given, that the JSON path holds the expected value). */
    protected function expect(array $response, int $status, string $step, ?string $path = null, mixed $value = null): bool
    {
        if (($response['status'] ?? 0) !== $status) {
            $this->fail($step, $status, $response);

            return false;
        }

        if ($path !== null && data_get($response['json'], $path) !== $value) {
            $this->result->addFail([
                'journey' => $this->name,
                'step' => $step." ({$path})",
                'expected' => $value,
                'actual' => data_get($response['json'], $path),
                'response' => $response['json'],
                'request' => null,
            ]);

            return false;
        }

        $this->result->addPass();

        return true;
    }

    /** A plain assertion, for values that are not an HTTP status. */
    protected function assert(mixed $actual, mixed $expected, string $step): bool
    {
        if ($actual !== $expected) {
            $this->result->addFail([
                'journey' => $this->name,
                'step' => $step,
                'expected' => $expected,
                'actual' => $actual,
                'response' => $this->context,
                'request' => null,
            ]);

            return false;
        }

        $this->result->addPass();

        return true;
    }

    protected function fail(string $step, int $expected, array $response): void
    {
        $this->result->addFail([
            'journey' => $this->name,
            'step' => $step,
            'expected' => $expected,
            'actual' => $response['status'] ?? 0,
            'response' => $response['json'] ?? null,
            'request' => $this->context,
        ]);
    }

    /** Signs in as the seeded admin and keeps the token for the rest of the journey. */
    protected function login(): bool
    {
        $response = $this->post('/api/v1/auth/login', [
            'login' => 'admin',
            'password' => 'password123',
        ]);

        if (! $this->expect($response, 200, 'login')) {
            return false;
        }

        $this->token = (string) data_get($response['json'], 'data.token');

        return $this->token !== '';
    }

    protected function markContext(string $label, array $value): void
    {
        $this->context[$label] = $value;
    }
}
