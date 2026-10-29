<?php

namespace App\Console\Commands;

use App\SystemTest\Journeys\AuthJourney;
use App\SystemTest\Reporting\ReportWriter;
use App\SystemTest\SafetyGuard;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;

class SystemTest extends Command
{
    protected $signature = 'system:test {--quick : Run quick test with seeded data} {--full : Run full test with restored data}';
    protected $description = 'Run the guarded system test suite';

    public function handle(): int
    {
        try {
            SafetyGuard::ensureTestEnvironment();
        } catch (\RuntimeException $e) {
            $this->error($e->getMessage());
            return 1;
        }

        $isQuick = $this->option('quick');
        $isFull = $this->option('full');

        if ($isFull) {
            $this->warn('--full mode is not yet implemented in Phase 1 skeleton.');
            return 0;
        }

        $this->info('Running system:test in --quick mode...');

        // Prepare test environment
        Artisan::call('migrate:fresh', ['--force' => true]);

        $startTime = microtime(true);
        $results = [];

        // Run journeys
        $journeys = [new AuthJourney()];

        foreach ($journeys as $journey) {
            $journeyStart = microtime(true);
            $result = $journey->run();
            $result->duration = microtime(true) - $journeyStart;
            $results[] = $result;

            $this->info(sprintf(
                'Journey %s: %d passed, %d failed',
                $result->name,
                $result->passed,
                $result->failed
            ));
        }

        $totalDuration = microtime(true) - $startTime;
        $totalFailed = array_sum(array_map(fn ($r) => $r->failed, $results));
        $totalPassed = array_sum(array_map(fn ($r) => $r->passed, $results));
        $totalTests = array_sum(array_map(fn ($r) => $r->total, $results));

        $this->info('');
        $this->info(sprintf(
            'System Test Complete: %d total, %d passed, %d failed (%.2fs)',
            $totalTests, $totalPassed, $totalFailed, $totalDuration
        ));

        // Save report
        $reportWriter = new ReportWriter();
        $timestamp = now()->format('Y-m-d_H-i-s');
        $jsonReport = $reportWriter->writeJson($results, $totalDuration);
        $textReport = $reportWriter->writeText($results, $totalDuration);

        $reportsDir = storage_path('app/system-test-reports');
        @mkdir($reportsDir, 0777, true);

        file_put_contents("{$reportsDir}/system-test-{$timestamp}.json", $jsonReport);
        file_put_contents("{$reportsDir}/system-test-{$timestamp}.txt", $textReport);

        $this->info('Reports saved to storage/app/system-test-reports/');

        return $totalFailed > 0 ? 1 : 0;
    }
}
