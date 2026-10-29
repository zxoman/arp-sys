<?php

namespace App\SystemTest\Reporting;

use App\SystemTest\JourneyResult;

class ReportWriter
{
    public function writeText(array $results, float $totalDuration): string
    {
        $lines = [];
        $lines[] = 'System Test Report';
        $lines[] = str_repeat('=', 50);
        $lines[] = '';
        $lines[] = sprintf('Total time: %.2fs', $totalDuration);
        $lines[] = '';

        $totalPassed = 0;
        $totalFailed = 0;
        $totalTests = 0;

        foreach ($results as $result) {
            $totalPassed += $result->passed;
            $totalFailed += $result->failed;
            $totalTests += $result->total;

            $lines[] = sprintf('Journey: %s', $result->name);
            $lines[] = sprintf('  Passed: %d, Failed: %d, Total: %d', $result->passed, $result->failed, $result->total);
            $lines[] = sprintf('  Duration: %.2fs', $result->duration);
            foreach ($result->failures as $failure) {
                $lines[] = sprintf('  FAIL [%s]: expected %s, got %s',
                    $failure['step'],
                    $failure['expected'],
                    $failure['actual']);
            }
            $lines[] = '';
        }

        $lines[] = 'Summary';
        $lines[] = str_repeat('-', 50);
        $lines[] = sprintf('Total: %d, Passed: %d, Failed: %d', $totalTests, $totalPassed, $totalFailed);
        $lines[] = '';

        return implode(PHP_EOL, $lines);
    }

    public function writeJson(array $results, float $totalDuration): string
    {
        $totalPassed = array_sum(array_map(fn ($r) => $r->passed, $results));
        $totalFailed = array_sum(array_map(fn ($r) => $r->failed, $results));
        $totalTests = array_sum(array_map(fn ($r) => $r->total, $results));

        $data = [
            'summary' => [
                'total' => $totalTests,
                'passed' => $totalPassed,
                'failed' => $totalFailed,
                'duration' => $totalDuration,
                'passed' => $totalFailed === 0,
            ],
            'journeys' => array_map(fn ($r) => [
                'name' => $r->name,
                'passed' => $r->passed,
                'failed' => $r->failed,
                'total' => $r->total,
                'duration' => $r->duration,
                'failures' => $r->failures,
            ], $results),
        ];

        return json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    }
}
