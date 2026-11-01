# Backups

Everything the system needs to come back after a crash lives in three places: the **database**, the
**uploaded logos inside it** (they are data URLs in `settings`, so a database dump covers them) and
`backend/.env` (the keys and credentials). The container in `storage/` holds compiled views and the
system-test reports, both disposable.

`php artisan backup:run` produces one self-contained archive and keeps a rotation of the last N.

## What a backup contains

| Item | Notes |
|---|---|
| `database.sql` | Full `mysqldump --single-transaction --routines --triggers` of the configured DB (gzip'ed inside the archive). |
| `env.json` | Only the **sensitive keys** (`APP_KEY`, DB credentials, mail, …), never the whole file — the archive is still a secret, but it does not carry unrelated host paths. |
| `manifest.json` | App name, versions, timestamp, row counts and the archive's own checksum input. |

## Commands

```bash
php artisan backup:run                    # create a backup now
php artisan backup:run --keep=30          # …and keep the newest 30 (default from BACKUP_KEEP)
php artisan backup:list                   # list the archives with size and date
php artisan backup:restore --latest       # restore the newest archive
php artisan backup:restore=2026-11-02_030000   # restore one specific archive
php artisan backup:verify                 # open every archive and check its manifest + SQL
php artisan backup:prune --keep=7         # delete all but the newest 7
```

Restoring asks for confirmation (`--force` skips it) and, after importing the SQL, clears the
Laravel caches so the restored `settings`/permissions are read fresh.

## Where they are stored

`storage/app/backups/` by default, one `.tar.gz` per run:
`arp-sys-YYYY-MM-DD_HHMMSS.tar.gz`. Override with `BACKUP_PATH` (absolute, or relative to the project
root). Files are written `0600` and the directory `0700`.

## Scheduling

`php artisan schedule:work` (or the system cron) runs `backup:run` daily at 02:30 and `backup:prune`
on Sundays; both are registered in `routes/console.php` and can be disabled per run with
`--no-schedule` on the CLI only — the scheduled commands respect `BACKUP_ENABLED=false`.

The production server uses the systemd timer `arp-backup.timer` (installed by
`backend/scripts/install-backup-timer.sh`), which is independent of the web process:

```bash
sudo systemctl list-timers arp-backup.timer
sudo systemctl start arp-backup.service      # run one now
journalctl -u arp-backup.service -n 30       # what the last run did
```

## Restore drill (do this once after setup)

```bash
php artisan backup:run
php artisan backup:verify
# on a scratch copy of the database, not production:
php artisan backup:restore --latest --force
```

A backup that has never been restored is not a backup: `DEFAULT` — the owner asked for the system on
2026-11-02 and the drill above is the acceptance test (`system:test --full` runs it against a scratch
database).
