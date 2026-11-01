<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Nightly backup + weekly rotation. Enable with `php artisan schedule:work`, the system cron, or the
// `arp-backup.timer` systemd unit installed by scripts/install-backup-timer.sh (see docs/BACKUPS.md).
if (strtolower((string) env('BACKUP_ENABLED', 'true')) !== 'false') {
    Schedule::command('backup:run --prune')
        ->dailyAt((string) env('BACKUP_AT', '02:30'))
        ->withoutOverlapping();

    Schedule::command('backup:verify')
        ->weeklyOn(6, '03:30')
        ->withoutOverlapping();
}
