<?php

namespace App\SystemTest\Journeys;

use App\Services\Backup\BackupService;
use App\SystemTest\Journey;
use App\SystemTest\JourneyResult;

/**
 * Backup drill: create → verify → prune. The restore itself is exercised by `system:test --full`,
 * because it rewrites the database the run is using.
 */
class BackupJourney extends Journey
{
    public function __construct()
    {
        parent::__construct('Backups');
    }

    public function run(): JourneyResult
    {
        $backups = app(BackupService::class);

        try {
            $path = $backups->run();
        } catch (\Throwable $e) {
            $this->result->addFail([
                'journey' => $this->name,
                'step' => 'create a backup',
                'expected' => 'archive written',
                'actual' => 'exception: '.$e->getMessage(),
                'response' => null,
                'request' => null,
            ]);

            return $this->result;
        }

        $this->assert(is_file($path) && filesize($path) > 0, true, 'archive written to disk');
        $this->assert(str_ends_with($path, '.tar.gz'), true, 'archive is a .tar.gz');

        try {
            $manifest = $backups->verify($path);
            $this->assert(isset($manifest['database']), true, 'manifest is readable');
            $this->assert((int) ($manifest['dump_bytes'] ?? 0) > 0, true, 'database dump is not empty');
            $this->assert(isset($manifest['row_counts']['users']), true, 'row counts recorded');
        } catch (\Throwable $e) {
            $this->result->addFail([
                'journey' => $this->name,
                'step' => 'verify the backup',
                'expected' => 'valid archive',
                'actual' => 'exception: '.$e->getMessage(),
                'response' => ['path' => $path],
                'request' => null,
            ]);
        }

        $backups->prune(1);
        $this->assert(count($backups->archives()), 1, 'prune keeps exactly the requested number');

        return $this->result;
    }
}
