#!/usr/bin/env bash
#
# Dev API server.
#
# `php artisan serve` on its own recompiles the whole Laravel framework on every
# request, because this PHP build has opcache disabled. That makes each API call
# take 0.3-0.9s and every page in the front feel slow. This script runs the same
# built-in server with:
#   * opcache enabled (files are compiled once, per worker process),
#   * several workers, so the parallel requests a page fires don't queue,
#   * `--no-reload`, which is what allows the workers.
#
# Nothing outside this repo is modified: the opcache ini is written to a temp
# directory and handed to PHP through PHP_INI_SCAN_DIR.
#
# Usage:  scripts/serve.sh            (http://127.0.0.1:8000)
#         PORT=8001 scripts/serve.sh
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PHP_BIN="${PHP_BIN:-/opt/lampp/bin/php}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
WORKERS="${WORKERS:-8}"

# opcache.so lives in the extension dir; this PHP build doesn't set `extension_dir`.
EXT_DIR="$("$PHP_BIN" -r 'echo ini_get("extension_dir");' 2>/dev/null || true)"
if [ -z "${EXT_DIR}" ] || [ ! -f "${EXT_DIR}/opcache.so" ]; then
  for dir in /opt/lampp/lib/php/extensions/*/; do
    if [ -f "${dir}opcache.so" ]; then EXT_DIR="${dir%/}"; break; fi
  done
fi
if [ -z "${EXT_DIR}" ] || [ ! -f "${EXT_DIR}/opcache.so" ]; then
  echo "opcache.so not found; run 'php -i | grep extension_dir' and set EXT_DIR" >&2
  exit 1
fi

INI_DIR="${TMPDIR:-/tmp}/arp_sys-php-conf.d"
mkdir -p "${INI_DIR}"
cat > "${INI_DIR}/opcache.ini" <<INI
zend_extension=${EXT_DIR}/opcache.so
opcache.enable=1
opcache.enable_cli=1
opcache.memory_consumption=256
opcache.interned_strings_buffer=32
opcache.max_accelerated_files=32531
opcache.validate_timestamps=1
opcache.revalidate_freq=0
realpath_cache_size=8192k
realpath_cache_ttl=600
INI

export PHP_INI_SCAN_DIR="${PHP_INI_SCAN_DIR:+${PHP_INI_SCAN_DIR}:}${INI_DIR}"
export PHP_CLI_SERVER_WORKERS="${WORKERS}"

exec "${PHP_BIN}" artisan serve --host="${HOST}" --port="${PORT}" --no-reload
