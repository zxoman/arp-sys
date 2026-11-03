#!/usr/bin/env bash
#
# Deploy the latest GitHub branch to the live server.
#
# The server has **no Node.js**, so the front is built here (where npm exists) and only the compiled
# `front/dist/` is copied over. The backend is pulled from GitHub on the server itself.
#
# Run it from the repository root:
#
#   ./deploy.sh                     # origin/master → server@192.168.1.50
#   ./deploy.sh --no-build          # backend only (no tsc/build/rsync)
#   ./deploy.sh --skip-backup       # no database backup at all (not recommended)
#   ./deploy.sh --no-fetch-backup   # back up on the server only, no local copy
#   ./deploy.sh --allow-dirty       # deploy even if the tree is not clean (front from the tree)
#   ./deploy.sh --dry-run           # print every step, change nothing
#
# Environment overrides:
#   DEPLOY_HOST    server@192.168.1.50   ssh target
#   DEPLOY_PATH    /var/www/arp-sys      project on the server
#   DEPLOY_BRANCH  master                branch to deploy
#   DEPLOY_URL     http://<host>         site checked at the end
#   REMOTE_PHP     php                   PHP binary on the server
#   SSH_PASS       -                     password for ssh/rsync (needs sshpass); prefer ssh keys
#   SUDO_PASS      -                     password for the storage-ownership step (optional)
#   DEPLOY_BACKUP_DIR  ~/arp-deploy-backups   where the archive is copied locally
#
# Any of the above can be put in an untracked .deploy.env next to this script instead of being typed
# on every run (copy .deploy.env.example). It is git-ignored, so the tree stays clean.
#
# Order: local pull → typecheck/build → **database backup (verified)** → server pull → composer →
# maintenance → migrate → optimize → copy front → permissions → up → smoke check.
#
set -Eeuo pipefail

# Local, machine-specific settings (server address, passwords) live in an untracked .deploy.env —
# see .deploy.env.example. Sourcing it first lets those values fill the defaults below while keeping
# the repository clean (the deploy refuses to run on a dirty tree).
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.deploy.env}"
if [[ -f "$DEPLOY_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$DEPLOY_ENV_FILE"
  set +a
fi

HOST="${DEPLOY_HOST:-server@192.168.1.50}"
REMOTE_PATH="${DEPLOY_PATH:-/var/www/arp-sys}"
BRANCH="${DEPLOY_BRANCH:-master}"
REMOTE_PHP="${REMOTE_PHP:-php}"
SITE_URL="${DEPLOY_URL:-http://${HOST#*@}}"
SSH_PASS="${SSH_PASS:-}"
SUDO_PASS="${SUDO_PASS:-}"
OWNER="${HOST%%@*}"   # ssh user, used for chown
LOCAL_BACKUP_DIR="${DEPLOY_BACKUP_DIR:-$HOME/arp-deploy-backups}"

DO_BUILD=1
DO_TYPECHECK=1
DO_BACKUP=1
DO_FETCH_BACKUP=1
ALLOW_DIRTY=0
DRY_RUN=0
MAINTENANCE=0
BACKUP_FILE=''

# ── output ────────────────────────────────────────────────────────────────────
step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  sed -n '3,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --no-typecheck) DO_TYPECHECK=0 ;;
    --skip-backup) DO_BACKUP=0 ;;
    --no-fetch-backup) DO_FETCH_BACKUP=0 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help) usage ;;
    *) die "unknown option: $arg (try --help)" ;;
  esac
done

run() {
  if ((DRY_RUN)); then
    printf '  [dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

# ── ssh / rsync plumbing ─────────────────────────────────────────────────────
SSH_ARGS=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ConnectTimeout=10)
if [[ -n "$SSH_PASS" ]]; then
  command -v sshpass >/dev/null || die 'SSH_PASS is set but sshpass is not installed (or use ssh keys)'
  export SSHPASS="$SSH_PASS"
  SSH=(sshpass -e ssh "${SSH_ARGS[@]}")
  RSYNC_SSH=(sshpass -e ssh "${SSH_ARGS[@]}")
else
  SSH=(ssh "${SSH_ARGS[@]}")
  RSYNC_SSH=(ssh "${SSH_ARGS[@]}")
fi

remote() { # remote '<shell line>'
  if ((DRY_RUN)); then
    printf '  [dry-run] ssh %s: %s\n' "$HOST" "$1"
    return 0
  fi
  "${SSH[@]}" "$HOST" "$1"
}

on_error() {
  local line="$1"
  printf '\n\033[1;31m✗ deploy failed (line %s)\033[0m\n' "$line" >&2
  if [[ -n "$BACKUP_FILE" ]]; then
    warn "pre-deploy backup: $BACKUP_FILE"
    warn "restore it with: ssh $HOST \"cd '$REMOTE_PATH/backend' && $REMOTE_PHP artisan backup:restore $(basename "$BACKUP_FILE") --force\""
  fi
  if ((MAINTENANCE)); then
    warn 'the site is in maintenance mode — bringing it back up'
    "${SSH[@]}" "$HOST" "cd '$REMOTE_PATH/backend' && $REMOTE_PHP artisan up" || true
    warn 'fix the error and run the script again'
  fi
  exit 1
}
trap 'on_error $LINENO' ERR

# ── 1. local preflight ───────────────────────────────────────────────────────
step 'Checking the local repository'
[[ -f backend/artisan && -f front/package.json ]] || die 'run this script from the repository root'
command -v git >/dev/null || die 'git is not installed'
command -v rsync >/dev/null || die 'rsync is not installed'
if ((DO_BUILD)); then
  command -v npm >/dev/null || die 'npm is not installed (needed to build the front); use --no-build'
fi

if [[ -n "$(git status --porcelain)" ]]; then
  if ((ALLOW_DIRTY)); then
    warn 'working tree is not clean — the front is built from the tree, not from GitHub'
  else
    die 'working tree is not clean; commit/push first, or pass --allow-dirty (machine settings belong in .deploy.env, which is ignored)'
  fi
fi

if ((DRY_RUN)); then
  note '[dry-run] skipping the ssh reachability check'
elif [[ -n "$SSH_PASS" ]]; then
  # BatchMode would forbid the password sshpass is about to type.
  "${SSH[@]}" -o NumberOfPasswordPrompts=1 "$HOST" true 2>/dev/null ||
    die "cannot ssh to $HOST with SSH_PASS (wrong password, or sshpass/ssh refused it)"
else
  "${SSH[@]}" -o BatchMode=yes "$HOST" true 2>/dev/null ||
    die "cannot ssh to $HOST (is the server up? try SSH_PASS=... $0)"
fi

# ── 2. latest from GitHub ────────────────────────────────────────────────────
step "Updating the local copy from origin/$BRANCH"
run git fetch --prune origin "$BRANCH"
current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  note "switching from $current_branch to $BRANCH"
  run git checkout --quiet "$BRANCH"
fi
run git merge --ff-only "origin/$BRANCH"

LOCAL_COMMIT="$(git rev-parse --short HEAD)"
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$BRANCH")" ]] && ((!ALLOW_DIRTY)); then
  die "local $BRANCH is not identical to origin/$BRANCH — push your commits first"
fi
note "commit to deploy: $LOCAL_COMMIT"

# ── 3. build the front here (the server has no node) ─────────────────────────
if ((DO_BUILD)); then
  step 'Building the front'
  if [[ ! -d front/node_modules ]]; then
    note 'installing front dependencies (npm ci)'
    run npm --prefix front ci
  fi
  if ((DO_TYPECHECK)); then
    note 'typechecking (tsc --noEmit)'
    (cd front && run npx tsc --noEmit)
  fi
  # Same-origin API: without this the production bundle calls http://localhost:8000/api/v1.
  (cd front && VITE_API_URL=/api/v1 run npm run build)
  [[ -f front/dist/index.html ]] || die 'front/dist/index.html was not produced'
  note "dist built: $(du -sh front/dist | cut -f1)"
else
  note 'skipping the front build (--no-build)'
fi

# ── 4. database backup — before anything on the server changes ───────────────
if ((DO_BACKUP)); then
  step 'Backing up the server database (before any change)'
  if ((DRY_RUN)); then
    remote "cd '$REMOTE_PATH/backend' && $REMOTE_PHP artisan backup:run --prune"
    remote "cd '$REMOTE_PATH/backend' && $REMOTE_PHP artisan backup:verify"
    ((DO_FETCH_BACKUP)) && note "[dry-run] rsync $HOST:<archive> → $LOCAL_BACKUP_DIR/"
  else
    BACKUP_OUT="$(remote "cd '$REMOTE_PATH/backend' && $REMOTE_PHP artisan backup:run --prune")" ||
      die 'the pre-deploy backup failed; refusing to change the server (fix it, or pass --skip-backup — not recommended)'
    printf '%s\n' "$BACKUP_OUT" | sed 's/^/  /'

    # `backup:run` prints «Backup written: /path/archive.tar.gz (12.3 KB)».
    BACKUP_FILE="$(printf '%s\n' "$BACKUP_OUT" | sed -n 's/^.*Backup written: \(.*\) ([0-9.]* KB)$/\1/p' | tail -n 1)"
    [[ -n "$BACKUP_FILE" ]] ||
      die 'backup:run wrote no archive (is BACKUP_ENABLED=false?); refusing to migrate without a backup — use --skip-backup to override'

    # An archive that cannot be opened is not a backup: verify it before migrating.
    remote "cd '$REMOTE_PATH/backend' && $REMOTE_PHP artisan backup:verify '$(basename "$BACKUP_FILE")'" | sed 's/^/  /' ||
      die "the new backup does not verify ($(basename "$BACKUP_FILE")); refusing to continue"
    note "restore point: $BACKUP_FILE"

    if ((DO_FETCH_BACKUP)); then
      mkdir -p "$LOCAL_BACKUP_DIR"
      if rsync -az -e "${RSYNC_SSH[*]}" "$HOST:$BACKUP_FILE" "$LOCAL_BACKUP_DIR/"; then
        note "local copy: $LOCAL_BACKUP_DIR/$(basename "$BACKUP_FILE")"
      else
        warn "could not copy the archive to $LOCAL_BACKUP_DIR (it is still on the server)"
      fi
    fi
  fi
else
  warn 'NO database backup before this deploy (--skip-backup)'
fi

if ((DRY_RUN)); then
  PREV_COMMIT=''
else
  PREV_COMMIT="$(remote "git -C '$REMOTE_PATH' rev-parse --short HEAD")"
fi
note "server was on: ${PREV_COMMIT:-unknown}"

# ── 5. pull the same branch on the server ────────────────────────────────────
step "Pulling $BRANCH on the server"
remote "cd '$REMOTE_PATH' && git fetch --prune origin '$BRANCH' && git checkout --quiet '$BRANCH' && git merge --ff-only 'origin/$BRANCH'"

step 'Installing backend dependencies (no dev)'
remote "cd '$REMOTE_PATH/backend' && composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader"

# ── 6. migrations under maintenance mode ─────────────────────────────────────
step 'Putting the site in maintenance mode'
remote "cd '$REMOTE_PATH/backend' && $REMOTE_PHP artisan down --retry=15" || warn 'could not enable maintenance mode; continuing'
MAINTENANCE=1

step 'Running migrations'
remote "cd '$REMOTE_PATH/backend' && $REMOTE_PHP artisan migrate --force"

step 'Rebuilding the caches'
remote "cd '$REMOTE_PATH/backend' && $REMOTE_PHP artisan optimize"

# ── 7. copy the built front ──────────────────────────────────────────────────
if ((DO_BUILD)); then
  step 'Copying the built front (rsync --delete)'
  if ((DRY_RUN)); then
    note "[dry-run] rsync -az --delete front/dist/ $HOST:$REMOTE_PATH/front/dist/"
  else
    rsync -az --delete -e "${RSYNC_SSH[*]}" front/dist/ "$HOST:$REMOTE_PATH/front/dist/"
  fi
fi

# ── 8. permissions ───────────────────────────────────────────────────────────
step 'Fixing storage permissions'
if [[ -n "$SUDO_PASS" ]]; then
  printf '%s\n' "$SUDO_PASS" |
    "${SSH[@]}" -T "$HOST" "sudo -S -p '' chown -R $OWNER:www-data '$REMOTE_PATH/backend/storage' '$REMOTE_PATH/backend/bootstrap/cache' && sudo -n chmod -R 775 '$REMOTE_PATH/backend/storage' '$REMOTE_PATH/backend/bootstrap/cache'"
else
  remote "cd '$REMOTE_PATH/backend' && chmod -R g+rwX storage bootstrap/cache && chgrp -R www-data storage bootstrap/cache" ||
    warn 'could not adjust group permissions (set SUDO_PASS=... to chown as root)'
fi

# ── 9. back online + smoke check ─────────────────────────────────────────────
step 'Bringing the site back up'
remote "cd '$REMOTE_PATH/backend' && $REMOTE_PHP artisan up"
MAINTENANCE=0

if ((DRY_RUN)); then
  note '[dry-run] skipping the smoke check'
  exit 0
fi

step "Checking $SITE_URL"
front_code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$SITE_URL/" || true)"
api_code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H 'Accept: application/json' "$SITE_URL/api/v1/admin/settings" || true)"
note "front: HTTP $front_code · api: HTTP $api_code (401 = up and asking for a token)"
[[ "$front_code" == '200' ]] || warn "the front answered $front_code, expected 200"
[[ "$api_code" == '401' || "$api_code" == '200' ]] || die "the API answered $api_code — check the server logs (storage/logs/laravel.log)"

DEPLOYED_COMMIT="$(remote "git -C '$REMOTE_PATH' log --oneline -1")"
step 'Done'
note "server now on: $DEPLOYED_COMMIT"
note "previous:      ${PREV_COMMIT:-unknown}"
if [[ "$DEPLOYED_COMMIT" != "$LOCAL_COMMIT"* ]] && ((!ALLOW_DIRTY)); then
  warn "the server commit does not match the local one ($LOCAL_COMMIT) — was the push complete?"
fi
note "site: $SITE_URL"
