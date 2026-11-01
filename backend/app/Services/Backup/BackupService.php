<?php

namespace App\Services\Backup;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use RuntimeException;
use Symfony\Component\Process\Process;

/**
 * Creates, verifies, restores and prunes the system's backup archives.
 *
 * An archive is a single `.tar.gz` holding:
 *   - `database.sql` (or `database.sqlite` for the SQLite driver)
 *   - `env.json`     — only the sensitive keys, never the whole .env
 *   - `manifest.json` — metadata + row counts, so a restore can be sanity-checked
 *
 * Nothing in here touches the live database except the read-only dump and the (confirmed) restore.
 */
class BackupService
{
    /** Keys copied out of `.env` into the archive. */
    private const SENSITIVE_KEYS = [
        'APP_NAME',
        'APP_ENV',
        'APP_KEY',
        'APP_URL',
        'DB_CONNECTION',
        'DB_HOST',
        'DB_PORT',
        'DB_DATABASE',
        'DB_USERNAME',
        'DB_PASSWORD',
        'MAIL_MAILER',
        'MAIL_HOST',
        'MAIL_PORT',
        'MAIL_USERNAME',
        'MAIL_PASSWORD',
        'MAIL_FROM_ADDRESS',
    ];

    /** Tables whose row counts go into the manifest (cheap sanity signal on restore). */
    private const COUNTED_TABLES = [
        'users', 'roles', 'settings', 'buildings', 'floors', 'units',
        'clients', 'reservations', 'contracts', 'installments', 'receipts', 'audit_logs',
    ];

    public function directory(): string
    {
        $configured = (string) env('BACKUP_PATH', '');
        $path = $configured !== '' ? $configured : storage_path('app/backups');

        if (! str_starts_with($path, DIRECTORY_SEPARATOR)) {
            $path = base_path($path);
        }

        if (! File::isDirectory($path)) {
            File::makeDirectory($path, 0700, true);
        }

        return rtrim($path, DIRECTORY_SEPARATOR);
    }

    public function keep(): int
    {
        return max(1, (int) env('BACKUP_KEEP', 14));
    }

    /** Creates one archive and returns its absolute path. */
    public function run(): string
    {
        $directory = $this->directory();
        $stamp = now()->format('Y-m-d_His');
        $name = 'arp-sys-'.$stamp.'.tar.gz';
        $target = $directory.DIRECTORY_SEPARATOR.$name;

        $work = $directory.DIRECTORY_SEPARATOR.'.work-'.$stamp;
        File::ensureDirectoryExists($work, 0700);

        try {
            $dumpFile = $this->dumpDatabase($work);
            $this->writeEnv($work.'/env.json');

            $manifest = [
                'name' => $name,
                'created_at' => now()->toIso8601String(),
                'app' => config('app.name'),
                'laravel' => app()->version(),
                'php' => PHP_VERSION,
                'connection' => DB::connection()->getDriverName(),
                'database' => DB::connection()->getDatabaseName(),
                'dump' => basename($dumpFile),
                'dump_bytes' => filesize($dumpFile),
                'row_counts' => $this->rowCounts(),
            ];

            file_put_contents(
                $work.'/manifest.json',
                json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            );

            $this->archive($work, $target);
            @chmod($target, 0600);

            return $target;
        } finally {
            File::deleteDirectory($work);
        }
    }

    /** Deletes everything but the newest `$keep` archives; returns the removed paths. */
    public function prune(?int $keep = null): array
    {
        $keep ??= $this->keep();
        $archives = $this->archives();

        if (count($archives) <= $keep) {
            return [];
        }

        $removed = [];
        foreach (array_slice($archives, $keep) as $path) {
            if (@unlink($path)) {
                $removed[] = $path;
            }
        }

        return $removed;
    }

    /**
     * All archives, newest first.
     *
     * @return list<string>
     */
    public function archives(): array
    {
        $files = glob($this->directory().DIRECTORY_SEPARATOR.'arp-sys-*.tar.gz') ?: [];
        usort($files, fn ($a, $b) => filemtime($b) <=> filemtime($a));

        return array_values($files);
    }

    public function latest(): ?string
    {
        return $this->archives()[0] ?? null;
    }

    /** Finds an archive by its timestamp (`2026-11-02_030000`), its file name, or its full path. */
    public function find(string $needle): ?string
    {
        if (is_file($needle)) {
            return $needle;
        }

        foreach ($this->archives() as $path) {
            $base = basename($path);
            if ($base === $needle || str_contains($base, $needle) || $path === $needle) {
                return $path;
            }
        }

        return null;
    }

    /**
     * Opens an archive and checks its structure. Returns the manifest, or throws.
     *
     * @return array<string, mixed>
     */
    public function verify(string $path): array
    {
        if (! is_file($path)) {
            throw new RuntimeException("Archive not found: {$path}");
        }

        $tar = $this->openArchive($path);
        $names = [];
        foreach (new \RecursiveIteratorIterator($tar) as $file) {
            $names[] = str_replace('phar://'.$path.'/', '', $file->getPathname());
        }

        foreach (['manifest.json', 'env.json'] as $required) {
            if (! in_array($required, $names, true)) {
                throw new RuntimeException("Archive {$path} is missing {$required}.");
            }
        }

        $manifest = json_decode((string) file_get_contents('phar://'.$path.'/manifest.json'), true);
        if (! is_array($manifest)) {
            throw new RuntimeException("Archive {$path} has an unreadable manifest.");
        }

        $dump = $manifest['dump'] ?? null;
        if (! is_string($dump) || ! in_array($dump, $names, true)) {
            throw new RuntimeException("Archive {$path} is missing its database dump.");
        }

        if ((int) ($manifest['dump_bytes'] ?? 0) <= 0) {
            throw new RuntimeException("Archive {$path} holds an empty database dump.");
        }

        return $manifest;
    }

    /**
     * Restores the database (and the sensitive env keys) from an archive.
     *
     * @return array<string, mixed> the manifest of the restored archive
     */
    public function restore(string $path): array
    {
        $manifest = $this->verify($path);

        $work = $this->directory().DIRECTORY_SEPARATOR.'.restore-'.now()->format('YmdHis');
        File::ensureDirectoryExists($work, 0700);

        try {
            $tar = $this->openArchive($path);
            $tar->extractTo($work);

            if (($manifest['connection'] ?? '') === 'sqlite') {
                $this->restoreSqlite($work.'/'.$manifest['dump']);
            } else {
                $this->importMysql($work.'/'.$manifest['dump']);
            }

            // A restored database may carry different settings/permissions than the cached ones.
            try {
                Artisan::call('optimize:clear');
            } catch (\Throwable) {
                // Caches are optional; a failure here must not fail the restore.
            }

            return $manifest;
        } finally {
            File::deleteDirectory($work);
        }
    }

    /* ------------------------------------------------------------------ */

    private function dumpDatabase(string $work): string
    {
        $connection = DB::connection();
        $driver = $connection->getDriverName();

        if ($driver === 'sqlite') {
            $source = $connection->getDatabaseName();
            if (! is_file($source)) {
                throw new RuntimeException("SQLite database not found: {$source}");
            }
            $target = $work.'/database.sqlite';
            copy($source, $target);

            return $target;
        }

        if ($driver !== 'mysql' && $driver !== 'mariadb') {
            throw new RuntimeException("Unsupported database driver for backups: {$driver}");
        }

        $target = $work.'/database.sql';
        $config = $connection->getConfig();

        $command = [
            $this->binary('mysqldump'),
            '--single-transaction',
            '--quick',
            '--routines',
            '--triggers',
            '--no-tablespaces',
            '--default-character-set=utf8mb4',
            ...$this->mysqlTarget($config),
            '--user='.($config['username'] ?? 'root'),
            (string) ($config['database'] ?? ''),
        ];

        $process = new Process($command, base_path(), $this->mysqlEnv($config), null, 600);
        $handle = fopen($target, 'wb');
        $process->run(function ($type, $buffer) use ($handle) {
            if ($type === Process::OUT) {
                fwrite($handle, $buffer);
            }
        });
        fclose($handle);

        if (! $process->isSuccessful()) {
            throw new RuntimeException('mysqldump failed: '.trim($process->getErrorOutput()));
        }

        if (filesize($target) === 0) {
            throw new RuntimeException('mysqldump produced an empty file.');
        }

        return $target;
    }

    private function writeEnv(string $target): void
    {
        $values = [];
        foreach (self::SENSITIVE_KEYS as $key) {
            $values[$key] = env($key);
        }

        file_put_contents(
            $target,
            json_encode($values, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );
        @chmod($target, 0600);
    }

    /** @return array<string, int> */
    private function rowCounts(): array
    {
        $counts = [];
        foreach (self::COUNTED_TABLES as $table) {
            try {
                $counts[$table] = (int) DB::table($table)->count();
            } catch (\Throwable) {
                // A table that does not exist yet (fresh install) is simply skipped.
            }
        }

        return $counts;
    }

    /**
     * Packs the working directory into `$target` (…tar.gz).
     *
     * PharData names the compressed file `<path>.gz`, and refuses a plain `.tar.gz` target (it keeps
     * a registry of open archives per process), so the archive is built as `.tar` first and renamed
     * once nothing holds it any more.
     */
    private function archive(string $directory, string $target): void
    {
        $tarPath = $target.'.tmp.tar';
        @unlink($tarPath);
        @unlink($tarPath.'.gz');

        $tar = new \PharData($tarPath);
        foreach (File::files($directory) as $file) {
            $tar->addFile($file->getPathname(), $file->getFilename());
        }

        $tar->compress(\Phar::GZ);
        unset($tar);

        if (! is_file($tarPath.'.gz')) {
            throw new RuntimeException('Could not compress the backup archive.');
        }

        copy($tarPath.'.gz', $target);

        // Phar keeps a per-process registry of the archives it opened; dropping the temporaries
        // (rather than renaming them) lets the same process verify/restore the file it just wrote.
        foreach ([$tarPath, $tarPath.'.gz'] as $temporary) {
            try {
                \Phar::unlinkArchive($temporary);
            } catch (\Throwable) {
                @unlink($temporary);
            }
        }
    }

    private function openArchive(string $path): \PharData
    {
        return new \PharData($path);
    }

    private function restoreSqlite(string $file): void
    {
        $target = DB::connection()->getDatabaseName();
        if (! is_file($file)) {
            throw new RuntimeException('The archive has no SQLite database file.');
        }
        copy($file, $target);
    }

    private function importMysql(string $file): void
    {
        $config = DB::connection()->getConfig();

        $command = [
            $this->binary('mysql'),
            ...$this->mysqlTarget($config),
            '--user='.($config['username'] ?? 'root'),
            (string) ($config['database'] ?? ''),
        ];

        $process = new Process($command, base_path(), $this->mysqlEnv($config), null, 900);
        $process->setInput(fopen($file, 'rb'));
        $process->run();

        if (! $process->isSuccessful()) {
            throw new RuntimeException('mysql import failed: '.trim($process->getErrorOutput()));
        }
    }

    /**
     * Where the client should connect. A socket wins over host/port, exactly like Laravel does — the
     * dev setup uses `DB_SOCKET` and `127.0.0.1` would hit a different (or no) server.
     *
     * @param  array<string, mixed>  $config
     * @return list<string>
     */
    private function mysqlTarget(array $config): array
    {
        $socket = (string) ($config['unix_socket'] ?? '');

        if ($socket !== '') {
            return ['--socket='.$socket];
        }

        return [
            '--host='.($config['host'] ?? '127.0.0.1'),
            '--port='.($config['port'] ?? '3306'),
        ];
    }

    /** @param array<string, mixed> $config */
    private function mysqlEnv(array $config): array
    {
        $env = [];
        if (($config['password'] ?? '') !== '' && ($config['password'] ?? null) !== null) {
            $env['MYSQL_PWD'] = (string) $config['password'];
        }

        return $env;
    }

    /** `mysqldump`/`mysql` from PATH, falling back to the XAMPP/MariaDB installs used in dev. */
    private function binary(string $name): string
    {
        foreach ([
            "/usr/bin/{$name}",
            "/usr/local/bin/{$name}",
            "/opt/lampp/bin/{$name}",
            "/opt/homebrew/bin/{$name}",
        ] as $candidate) {
            if (is_executable($candidate)) {
                return $candidate;
            }
        }

        return $name;
    }
}
