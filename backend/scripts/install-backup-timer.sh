#!/usr/bin/env bash
# Installs a systemd timer that runs the nightly backup, independent of the web process.
#   sudo bash backend/scripts/install-backup-timer.sh [/var/www/arp-sys]
set -euo pipefail

APP_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PHP_BIN="${PHP_BIN:-$(command -v php)}"
RUN_USER="${RUN_USER:-www-data}"
AT="${BACKUP_AT:-03:30}"

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo." >&2
  exit 1
fi

cat >/etc/systemd/system/arp-backup.service <<UNIT
[Unit]
Description=arp-sys database backup
After=network.target mariadb.service

[Service]
Type=oneshot
User=${RUN_USER}
WorkingDirectory=${APP_DIR}/backend
ExecStart=${PHP_BIN} artisan backup:run --prune
StandardOutput=journal
StandardError=journal
UNIT

cat >/etc/systemd/system/arp-backup.timer <<UNIT
[Unit]
Description=Nightly arp-sys backup

[Timer]
OnCalendar=*-*-* ${AT}:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now arp-backup.timer

echo "Installed. Next runs:"
systemctl list-timers arp-backup.timer --no-pager
echo
echo "Run one now:  sudo systemctl start arp-backup.service && journalctl -u arp-backup.service -n 30"
