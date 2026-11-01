<?php

namespace App\Console\Commands;

use App\Services\Backup\BackupService;
use Illuminate\Console\Command;

class BackupRun extends Command
{
    protected $signature = 'backup:run
        {--keep= : How many archives to keep after the run (default from BACKUP_KEEP)}
        {--prune : Also prune old archives after a successful run}';

    protected $description = 'Create a full backup archive (database + sensitive env keys + manifest)';

    public function handle(BackupService $backups): int
    {
        if (strtolower((string) env('BACKUP_ENABLED', 'true')) === 'false' && ! $this->option('prune')) {
            $this->warn('BACKUP_ENABLED=false — skipping.');

            return self::SUCCESS;
        }

        try {
            $path = $backups->run();
        } catch (\Throwable $e) {
            $this->error('Backup failed: '.$e->getMessage());

            return self::FAILURE;
        }

        $this->info(sprintf(
            'Backup written: %s (%.1f KB)',
            $path,
            filesize($path) / 1024
        ));

        $keep = $this->option('keep') !== null ? (int) $this->option('keep') : null;
        if ($this->option('prune') || $keep !== null) {
            $removed = $backups->prune($keep);
            $this->line(sprintf('Pruned %d old archive(s); keeping %d.', count($removed), $keep ?? $backups->keep()));
        }

        return self::SUCCESS;
    }
}
