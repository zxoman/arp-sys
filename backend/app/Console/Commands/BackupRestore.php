<?php

namespace App\Console\Commands;

use App\Services\Backup\BackupService;
use Illuminate\Console\Command;

class BackupRestore extends Command
{
    protected $signature = 'backup:restore
        {archive? : Timestamp or file name of the archive}
        {--latest : Restore the newest archive}
        {--force : Skip the confirmation prompt}';

    protected $description = 'Restore the database from a backup archive (asks for confirmation)';

    public function handle(BackupService $backups): int
    {
        $path = $this->option('latest')
            ? $backups->latest()
            : ($this->argument('archive') ? $backups->find((string) $this->argument('archive')) : null);

        if (! $path) {
            $this->error('Nothing to restore — pass an archive timestamp, a file name, or --latest.');

            return self::FAILURE;
        }

        try {
            $manifest = $backups->verify($path);
        } catch (\Throwable $e) {
            $this->error('Refusing to restore: '.$e->getMessage());

            return self::FAILURE;
        }

        $this->warn(sprintf('About to restore %s into database «%s».', basename($path), $manifest['database'] ?? '?'));

        if (! $this->option('force') && ! $this->confirm('This overwrites the current data. Continue?', false)) {
            $this->line('Cancelled.');

            return self::SUCCESS;
        }

        try {
            $backups->restore($path);
        } catch (\Throwable $e) {
            $this->error('Restore failed: '.$e->getMessage());

            return self::FAILURE;
        }

        $this->info('Restored '.basename($path).'.');

        return self::SUCCESS;
    }
}
