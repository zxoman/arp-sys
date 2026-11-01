<?php

namespace App\Console\Commands;

use App\Services\Backup\BackupService;
use Illuminate\Console\Command;

class BackupList extends Command
{
    protected $signature = 'backup:list';

    protected $description = 'List the backup archives, newest first';

    public function handle(BackupService $backups): int
    {
        $archives = $backups->archives();

        if (! $archives) {
            $this->warn('No backups yet — run `php artisan backup:run`.');

            return self::SUCCESS;
        }

        $this->table(
            ['#', 'File', 'Created', 'Size'],
            array_map(fn ($path, $i) => [
                $i + 1,
                basename($path),
                date('Y-m-d H:i:s', filemtime($path)),
                number_format(filesize($path) / 1024, 1).' KB',
            ], $archives, array_keys($archives))
        );

        $this->line(sprintf('%d archive(s) in %s — keeping the newest %d.', count($archives), $backups->directory(), $backups->keep()));

        return self::SUCCESS;
    }
}
