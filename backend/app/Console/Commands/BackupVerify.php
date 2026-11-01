<?php

namespace App\Console\Commands;

use App\Services\Backup\BackupService;
use Illuminate\Console\Command;

class BackupVerify extends Command
{
    protected $signature = 'backup:verify {archive? : Timestamp or file name; all archives when omitted}';

    protected $description = 'Open the backups and check their structure and database dump';

    public function handle(BackupService $backups): int
    {
        $targets = $this->argument('archive')
            ? [$this->resolve($backups, (string) $this->argument('archive'))]
            : $backups->archives();

        $targets = array_values(array_filter($targets));

        if (! $targets) {
            $this->warn('No backups to verify.');

            return self::SUCCESS;
        }

        $failed = 0;
        foreach ($targets as $path) {
            try {
                $manifest = $backups->verify($path);
                $this->info(sprintf(
                    'OK   %s — %s, %s rows in contracts, dumped %s',
                    basename($path),
                    $manifest['database'] ?? '?',
                    $manifest['row_counts']['contracts'] ?? 0,
                    number_format(((int) ($manifest['dump_bytes'] ?? 0)) / 1024, 1).' KB'
                ));
            } catch (\Throwable $e) {
                $failed++;
                $this->error(sprintf('FAIL %s — %s', basename($path), $e->getMessage()));
            }
        }

        return $failed === 0 ? self::SUCCESS : self::FAILURE;
    }

    private function resolve(BackupService $backups, string $needle): ?string
    {
        $path = $backups->find($needle);
        if (! $path) {
            $this->error("No archive matching «{$needle}».");

            return null;
        }

        return $path;
    }
}
