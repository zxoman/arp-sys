# Deployment (single Linux server)

Everything runs on one machine behind nginx: the built React app as static files and the Laravel API
through PHP-FPM. No Node.js is needed on the server (the front is built where `npm` exists and the
`dist/` folder is copied over).

The live setup described below is `server@192.168.1.50`, Ubuntu 26.04, nginx 1.28, PHP 8.5 FPM,
MariaDB 11.8, project at `/var/www/arp-sys` — reachable at <http://192.168.1.50/>.

## 1. Packages

```bash
sudo apt-get update
sudo apt-get install -y nginx mariadb-server composer unzip git \
  php8.5-fpm php8.5-cli php8.5-mbstring php8.5-xml php8.5-curl php8.5-bcmath \
  php8.5-intl php8.5-gd php8.5-zip php8.5-mysql php8.5-sqlite3
```

`php8.5-*` is the only PHP version in Ubuntu 26.04 (`resolute`); the app requires `^8.2` so it is fine.
No `opcache` package exists there — PHP-FPM ships with it.

## 2. Database

```sql
CREATE DATABASE arp_sys CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'arp'@'localhost' IDENTIFIED BY '<strong-password>';
GRANT ALL PRIVILEGES ON arp_sys.* TO 'arp'@'localhost';
FLUSH PRIVILEGES;
```

## 3. Code and backend `.env`

```bash
sudo mkdir -p /var/www/arp-sys && sudo chown $USER:www-data /var/www/arp-sys
git clone https://github.com/zxoman/arp-sys.git /tmp/arp-sys-clone
sudo sh -c 'shopt -s dotglob; mv /tmp/arp-sys-clone/* /var/www/arp-sys/ && rmdir /tmp/arp-sys-clone'
sudo chown -R $USER:www-data /var/www/arp-sys
```

`backend/.env` for production — the differences from `.env.example` that matter:

```dotenv
APP_ENV=production
APP_DEBUG=false
APP_URL=http://192.168.1.50
APP_LOCALE=ar
# No APP_TIMEZONE: the app keeps Laravel's UTC on purpose so date-only columns
# (contract_date, due_date, …) serialise as the exact day that was entered.

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_DATABASE=arp_sys
DB_USERNAME=arp
DB_PASSWORD=<strong-password>

# The SPA authenticates with a Bearer token only. Leaving this host inside
# sanctum.stateful turns CSRF on for it and makes POST /api/v1/auth/login answer 419.
SANCTUM_STATEFUL_DOMAINS=localhost
```

```bash
cd /var/www/arp-sys/backend
composer install --no-dev --prefer-dist --optimize-autoloader
php artisan key:generate --force
php artisan migrate --seed --force   # first admin: admin / password123 — CHANGE IT after the first login
```

`--seed` runs the base seeders only: the first admin, roles, permissions and the (empty) project
settings. There is no demo/fake data anywhere in the repository — the database starts empty.

## 4. Permissions

The PHP-FPM user (`www-data`) must be able to write storage and the compiled config:

```bash
sudo chown -R $USER:www-data backend/storage backend/bootstrap/cache
sudo chmod -R 775 backend/storage backend/bootstrap/cache
```

## 5. nginx

`/etc/nginx/sites-available/arp-sys` (symlinked into `sites-enabled`, default site removed):

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name 192.168.1.50 _;

    root /var/www/arp-sys/front/dist;
    index index.html;

    charset utf-8;
    client_max_body_size 20m;

    # Laravel API — every /api/ request goes through backend/public/index.php.
    location ^~ /api/ {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME /var/www/arp-sys/backend/public/index.php;
        fastcgi_param SCRIPT_NAME /index.php;
        fastcgi_param DOCUMENT_ROOT /var/www/arp-sys/backend/public;
        fastcgi_param PATH_INFO $uri;
        fastcgi_pass unix:/run/php/php8.5-fpm.sock;
        fastcgi_read_timeout 120s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`sudo nginx -t && sudo systemctl reload nginx`.

## 6. Front build

The bundle must call the API on its own origin, otherwise the production build falls back to
`http://localhost:8000/api/v1` (`front/src/lib/api.ts`):

```bash
cd front
VITE_API_URL=/api/v1 npm run build
rsync -az --delete front/dist/ server@192.168.1.50:/var/www/arp-sys/front/dist/
```

## 7. Optimise caches

```bash
cd /var/www/arp-sys/backend
php artisan optimize        # config + routes + views + events
```

Re-run `php artisan optimize` after every deploy that changes `.env` or routes.

## Updating a running server

```bash
cd /var/www/arp-sys
git pull
cd backend && composer install --no-dev --prefer-dist --optimize-autoloader \
  && php artisan migrate --force && php artisan optimize
# and rsync a fresh front/dist when the front changed
```

No queue worker and no scheduler are needed: the app dispatches no queued jobs and registers no
scheduled commands.

## A local domain (`aqar.lan`)

The server answers on **http://aqar.lan/** as well as on its IP. On this install:

| Piece | Value |
|---|---|
| DNS | `dnsmasq` on the server, bound to `192.168.1.50:53` only (systemd-resolved keeps `127.0.0.53`). Config: `/etc/dnsmasq.d/arp-sys.conf`. Serves `aqar.lan`, `*.aqar.lan` and the short name `aqar` → `192.168.1.50`; everything else is forwarded to the router (`192.168.1.1`), with `1.1.1.1` as a fallback. |
| nginx | `server_name aqar.lan *.aqar.lan 192.168.1.50 _;` — both names serve the same site. |
| Laravel | `APP_URL=http://aqar.lan` (front is built with `VITE_API_URL=/api/v1`, so it is same-origin and needed no rebuild). `SANCTUM_STATEFUL_DOMAINS` stays `localhost`: the SPA is Bearer-token only, and stateful mode would demand CSRF and answer 419 on login. |

**Make the whole LAN use it (one-time router change):** in the router's DHCP settings set the DNS
server to `192.168.1.50`, then reconnect devices (or wait for the lease). Any device that gets its DNS
from the router now resolves `aqar.lan` with no per-device setup.

Check it:

```bash
dig +short @192.168.1.50 aqar.lan          # → 192.168.1.50
curl -s -o /dev/null -w '%{http_code}\n' http://aqar.lan/
```

**Without touching the router** (one machine at a time), add to its hosts file:

```
192.168.1.50   aqar.lan
```

- Linux/macOS: `sudo nano /etc/hosts`
- Windows: `C:\Windows\System32\drivers\etc\hosts` (run Notepad as administrator)

Diagnostics: `sudo journalctl -u dnsmasq -n 30`, `sudo dnsmasq --test`, `sudo ss -lunp | grep :53`
(only `192.168.1.50` should be dnsmasq's).

> The name is HTTP-only on purpose (a trusted office LAN): no certificate warnings, nothing to install
> on phones. If HTTPS is needed later, issue a certificate for `aqar.lan` from a local CA (mkcert) and
> install that CA on each device, then set `APP_URL=https://aqar.lan` and rebuild the front.

## Notes

- Login is single-session per user: any new `POST /auth/login` revokes the previous token.
- The site is HTTP only. Behind a real (public) domain, add HTTPS (`certbot --nginx`) and set `APP_URL`
  to the `https://` address, otherwise the built URLs and Sanctum's host check keep the old one.
- The LAN name `aqar.lan` is served by the server's own dnsmasq — see «A local domain» above.
- `front/dist` is served by nginx directly; the SPA is hash-routed, so deep links also work.
