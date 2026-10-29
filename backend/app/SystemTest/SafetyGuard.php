<?php

namespace App\SystemTest;

use App\Support\Clock\FrozenClock;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Str;

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
        $dbName = config('database.connections.mysql.database', '');
        $dbHost = config('database.connections.mysql.host', '127.0.0.1');
        $dbSocket = config('database.connections.mysql.unix_socket', '');

        // APP_ENV must not be production
        if ($appEnv === 'production') {
            throw new \RuntimeException(
                'Safety guard aborted: APP_ENV is production. Refusing to run system:test.'
            );
        }

        // Database name must clearly identify a test database
        $isTestDb = preg_match('/(^|[^a-zA-Z])test([^a-zA-Z]|$)/i', $dbName)
            || str_contains(strtolower($dbName), 'test')
            || str_contains(strtolower($dbName), '_testing');

        if (!$isTestDb) {
            throw new \RuntimeException(
                'Safety guard aborted: database name ("' . $dbName . '") does not look like a test database.'
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
