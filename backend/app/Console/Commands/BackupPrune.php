<?php

namespace App\Console\Commands;

use App\Services\Backup\BackupService;
use Illuminate\Console\Command;

class BackupPrune extends Command
{
    protected $signature = 'backup:prune {--keep= : Archives to keep (default from BACKUP_KEEP)}';

    protected $description = 'Delete old backup archives, keeping the newest N';

    public function handle(BackupService $backups): int
    {
        $keep = $this->option('keep') !== null ? (int) $this->option('keep') : null;
        $removed = $backups->prune($keep);

        $this->info(sprintf(
            'Removed %d archive(s); %d remain (keeping %d).',
            count($removed),
            count($backups->archives()),
            $keep ?? $backups->keep()
        ));

        return self::SUCCESS;
    }
}
