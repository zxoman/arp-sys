<?php

namespace App\SystemTest;

class SafetyGuard
{
    /**
     * Abort if the target environment looks like production.
     *
     * @throws \RuntimeException
     */
    public static function ensureTestEnvironment(): void
    {
        $appEnv = config('app.env', 'production');
        $driver = config('database.default', 'mysql');
        $dbName = (string) config("database.connections.{$driver}.database", '');
        $dbHost = (string) config("database.connections.{$driver}.host", '127.0.0.1');
        $dbSocket = (string) config("database.connections.{$driver}.unix_socket", '');

        // APP_ENV must not be production
        if ($appEnv === 'production') {
            throw new \RuntimeException(
                'Safety guard aborted: APP_ENV is production. Refusing to run system:test.'
            );
        }

        // An explicit opt-in for a scratch database whose name does not say "test".
        if (filter_var(env('SYSTEM_TEST_FORCE', false), FILTER_VALIDATE_BOOLEAN)) {
            return;
        }

        // Database name must clearly identify a test database
        $isTestDb = self::isTestDatabase($dbName) || $driver === 'sqlite' && str_contains($dbName, 'test');

        if (! $isTestDb) {
            throw new \RuntimeException(
                'Safety guard aborted: database name ("'.$dbName.'") does not look like a test database.'
            );
        }

        // If using TCP, host must differ from production (or be localhost for socket)
        if (empty($dbSocket) && $dbHost === config('app.production_db_host', '')) {
            throw new \RuntimeException(
                'Safety guard aborted: database host points at production.'
            );
        }
    }

    public static function isTestDatabase(string $dbName): bool
    {
        return (bool) preg_match('/(^|[^a-zA-Z])test([^a-zA-Z]|$)/i', $dbName)
            || str_contains(strtolower($dbName), 'test')
            || str_contains(strtolower($dbName), '_testing');
    }
}
