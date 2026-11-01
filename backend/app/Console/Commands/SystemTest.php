<?php

namespace App\Console\Commands;

use App\Services\Backup\BackupService;
use App\SystemTest\Journey;
use App\SystemTest\JourneyResult;
use App\SystemTest\Journeys\AdminJourney;
use App\SystemTest\Journeys\AuthJourney;
use App\SystemTest\Journeys\BackupJourney;
use App\SystemTest\Journeys\DealJourney;
use App\SystemTest\Journeys\PropertyJourney;
use App\SystemTest\Reporting\ReportWriter;
use App\SystemTest\SafetyGuard;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;

/**
 * End-to-end test of the whole system, on a disposable database.
 *
 *   --quick  migrate a fresh database, seed the base data and run every journey over real HTTP.
 *   --full   the same, plus a restore drill: back up, wipe, restore, and re-check that the data came back.
 *
 * Refuses to run unless APP_ENV is not production and the database name looks like a test database
 * (SafetyGuard), because it migrates fresh and can restore over the database.
 */
class SystemTest extends Command
{
    protected $signature = 'system:test
        {--quick : Fresh test database + every journey (default)}
        {--full : --quick plus a backup/restore drill}
        {--keep : Keep the test database after the run instead of rolling it back}';

    protected $description = 'Run the guarded end-to-end system test (journeys + optional restore drill)';

    public function handle(): int
    {
        try {
            SafetyGuard::ensureTestEnvironment();
        } catch (\RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $full = (bool) $this->option('full');

        $this->info('Preparing a fresh test database…');
        Artisan::call('migrate:fresh', ['--force' => true, '--seed' => true]);
        $this->line('  '.trim(Artisan::output()));

        $started = microtime(true);
        $results = [];

        /** @var list<Journey> $journeys */
        $journeys = [
            new AuthJourney,
            new PropertyJourney,
            new DealJourney,
            new AdminJourney,
            new BackupJourney,
        ];

        foreach ($journeys as $journey) {
            $before = microtime(true);
            $result = $journey->run();
            $result->duration = microtime(true) - $before;
            $results[] = $result;

            $this->line(sprintf(
                '  %s %s — %d passed, %d failed (%.2fs)',
                $result->failed === 0 ? '<fg=green>✔</>' : '<fg=red>✘</>',
                $result->name,
                $result->passed,
                $result->failed,
                $result->duration
            ));

            foreach ($result->failures as $failure) {
                $this->line(sprintf(
                    '      <fg=red>%s</> — expected %s, got %s',
                    $failure['step'],
                    is_scalar($failure['expected']) ? (string) $failure['expected'] : json_encode($failure['expected']),
                    is_scalar($failure['actual']) ? (string) $failure['actual'] : json_encode($failure['actual'])
                ));
            }
        }

        if ($full) {
            $results[] = $this->restoreDrill();
        }

        $duration = microtime(true) - $started;
        $passed = array_sum(array_map(fn ($r) => $r->passed, $results));
        $failed = array_sum(array_map(fn ($r) => $r->failed, $results));
        $total = array_sum(array_map(fn ($r) => $r->total, $results));

        $this->newLine();
        $this->info(sprintf('System test: %d checks, %d passed, %d failed (%.2fs)', $total, $passed, $failed, $duration));

        $writer = new ReportWriter;
        $directory = storage_path('app/system-test-reports');
        @mkdir($directory, 0777, true);
        $stamp = now()->format('Y-m-d_H-i-s');

        file_put_contents("{$directory}/system-test-{$stamp}.json", $writer->writeJson($results, $duration));
        file_put_contents("{$directory}/system-test-{$stamp}.txt", $writer->writeText($results, $duration));

        $this->line("Reports: storage/app/system-test-reports/system-test-{$stamp}.{json,txt}");

        return $failed === 0 ? self::SUCCESS : self::FAILURE;
    }

    /**
     * Backup → wipe the data → restore → confirm the data is back. This is the only way to know the
     * backups actually work, so `--full` exists for it.
     */
    private function restoreDrill(): JourneyResult
    {
        $result = new JourneyResult('Backup restore drill');
        $started = microtime(true);
        $backups = app(BackupService::class);

        $marker = 'drill-'.now()->format('His');
        DB::table('settings')->updateOrInsert(['key' => 'drill_marker'], ['value' => $marker]);
        $restored = DB::table('settings')->where('key', 'drill_marker')->value('value');
        $restored === $marker ? $result->addPass() : $result->addFail([
            'journey' => $result->name,
            'step' => 'write the drill marker',
            'expected' => $marker,
            'actual' => $restored,
            'response' => null,
            'request' => null,
        ]);

        try {
            $archive = $backups->run();
            $result->addPass();

            // Prove the data really disappeared before restoring.
            DB::table('settings')->where('key', 'drill_marker')->delete();
            DB::table('clients')->delete();
            $wiped = DB::table('settings')->where('key', 'drill_marker')->exists();
            $wiped ? $result->addFail([
                'journey' => $result->name,
                'step' => 'wipe before restore',
                'expected' => 'marker gone',
                'actual' => 'marker still present',
                'response' => null,
                'request' => null,
            ]) : $result->addPass();

            // Restore through the real CLI command in its own process: that is exactly what an
            // operator runs, and it keeps this process's DB connection honest.
            $process = new Process(
                [PHP_BINARY, base_path('artisan'), 'backup:restore', $archive, '--force'],
                base_path(),
                ['DB_DATABASE' => (string) config('database.connections.'.config('database.default').'.database')],
                null,
                600
            );
            $process->run();

            if (! $process->isSuccessful()) {
                throw new \RuntimeException('backup:restore failed: '.trim($process->getErrorOutput().$process->getOutput()));
            }

            DB::purge();
            $restored = DB::table('settings')->where('key', 'drill_marker')->value('value');
            $restored === $marker
                ? $result->addPass()
                : $result->addFail([
                    'journey' => $result->name,
                    'step' => 'restore brings the data back',
                    'expected' => $marker,
                    'actual' => $restored,
                    'response' => ['archive' => basename($archive)],
                    'request' => null,
                ]);
        } catch (\Throwable $e) {
            $result->addFail([
                'journey' => $result->name,
                'step' => 'backup/restore drill',
                'expected' => 'success',
                'actual' => 'exception: '.$e->getMessage(),
                'response' => null,
                'request' => null,
            ]);
        } finally {
            $result->duration = microtime(true) - $started;
        }

        $this->line(sprintf(
            '  %s %s — %d passed, %d failed (%.2fs)',
            $result->failed === 0 ? '<fg=green>✔</>' : '<fg=red>✘</>',
            $result->name,
            $result->passed,
            $result->failed,
            $result->duration
        ));

        return $result;
    }
}
