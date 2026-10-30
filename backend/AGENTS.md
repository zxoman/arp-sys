# Real Estate Management API (Laravel) — Agent Guide

Internal real-estate management backend (NOT a public marketplace). Arabic RTL clients.
Source of truth: `docs/BRIEF.md`. If this file and the brief disagree, the brief wins.
Never invent business rules. If something is missing, ask. Items marked DEFAULT (unconfirmed)
must stay easy to change and be listed in `docs/DEFAULTS.md`.

## Stack
- Laravel 12, PHP 8.2+, API-only (`routes/api.php`, prefix `/api/v1`), Sanctum tokens.
- MariaDB 10.4.28 (local XAMPP dev) — target MySQL 8 in production. Keep queries portable; engine-specific guards isolated in migrations.
- Pest for tests. Default runs use SQLite `:memory:` (see `phpunit.xml`) for speed; anything that depends on
  MySQL/MariaDB behavior (triggers, row locks, concurrent requests) must be guarded with `DB::getDriverName()`
  and verified manually against MariaDB.
- Frontend lives in `../front` (React prototype). Reference only; do not edit it from here.

## Runtime (this machine)
- PHP: `/opt/lampp/bin/php` (8.2.4)
- Composer: `/tmp/opencode/composer` → run as `/opt/lampp/bin/php /tmp/opencode/composer`
- MariaDB: started manually via `/opt/lampp/sbin/mariadbd --defaults-file=/tmp/opencode/my.cnf` (socket `/tmp/opencode/mysql-run/mysqld.sock`, port 3307)
- DB: `arp_sys` (dev), `arp_sys_test` (for `system:test`), user `root`, no password
- `.env` already configured: `DB_CONNECTION=mysql`, `DB_SOCKET=/tmp/opencode/mysql-run/mysqld.sock`, `DB_DATABASE=arp_sys`
- If `/tmp/opencode` is wiped, recreate the instance:
  `mkdir -p /tmp/opencode/mysql-data /tmp/opencode/mysql-run`, write `my.cnf` (datadir/socket/port 3307/utf8mb4),
  run `/opt/lampp/bin/mysql_install_db --defaults-file=/tmp/opencode/my.cnf --datadir=/tmp/opencode/mysql-data --auth-root-authentication-method=normal`,
  start the daemon in the background, then create `arp_sys` and `arp_sys_test`.

## Commands
- Install: `/opt/lampp/bin/php /tmp/opencode/composer install`
- Migrate + seed: `/opt/lampp/bin/php artisan migrate --seed`
- Tests: `/opt/lampp/bin/php artisan test` (or `/opt/lampp/bin/php vendor/bin/pest`)
- Demo data (GitHub Actions preview only): `php artisan db:seed --class=DemoSeeder` — needs an empty
  database; it creates 2 buildings, 6 units, 4 clients, 3 contracts and 1 reservation through the normal
  services. Never run it against real data.
- Single test: `/opt/lampp/bin/php vendor/bin/pest --filter=Name`
- System test: `/opt/lampp/bin/php artisan system:test --quick` | `--full`
- Lint/format: `/opt/lampp/bin/php vendor/bin/pint`

## Running the dev API
- Always start it with `./scripts/serve.sh` (`PORT=8001 ./scripts/serve.sh` to change the port), **not**
  `artisan serve` directly. This PHP build has opcache disabled in `/opt/lampp/etc/php.ini` (root-owned), so
  a plain `artisan serve` recompiles the whole framework on every request: 0.3–0.9s per API call. The script
  hands PHP an extra ini through `PHP_INI_SCAN_DIR` (nothing outside `/tmp` is modified) and starts the
  built-in server with that opcache plus `PHP_CLI_SERVER_WORKERS` — ~0.08–0.12s per call, and the parallel
  requests a page fires don't queue behind each other.
- `PHP_CLI_SERVER_WORKERS` only takes effect together with `--no-reload` (the script always passes it), so
  PHP edits need a server restart — that is the price of the workers.
- CORS preflights are cached by the browser for 2h (`config/cors.php`, `max_age => 7200`); in dev the Vite
  server proxies `/api` so the front-end makes same-origin calls and sends no preflight at all.

## Build phases (stop after each one: run tests, summarize, list assumptions, wait for confirmation)
1. Foundation: auth, users, roles/permissions, audit log, Money/Arabic/Phone/Clock helpers, guarded system:test skeleton
2. Buildings (activities, auto floors, autocomplete) -> Units
3. Clients
4. Reservations + reservation payments
5. Contracts, installment schedule + preview, down-payment and installment payments, collection
6. Reports + exports (Excel/PDF)
7. Backups + admin backups page
8. Full system:test, integrity scans, performance

## Current state (2026-10-29)
- Phases 1-6 are implemented: auth/users/roles/audit, buildings+units, clients, reservations+payments,
  contracts+installments+payments, reports.
- Phase 7 (backups) is deliberately DEFERRED until a server exists.
- Phase 8 is pending: `system:test` journeys still use an in-process HTTP mock, so they fail; they need a real server.
- Single project: `projects` table and `project_id` columns are REMOVED. Project name/address live in `settings`
  (`project_name`, `project_address`) seeded once by `SettingsSeeder`, edited via `/api/v1/admin/settings`.
  The project statement report and `projects.*` / `reports.project` permissions were removed.
- Seeders: `migrate --seed` creates the first admin (`admin` / `password123`) and empty project settings.
- Unit purpose/sale fields (2026-10-28): `purpose` (sale|rent|both), `is_sellable` + `non_sellable_reason`,
  `sale_price` (overrides area x price_per_meter). Enforced on reservations and contracts; see BRIEF 2.3/2.5/2.6.
- Clients (2026-10-28): `phone` + optional `phone_2`, both normalized and both covered by the duplicate warning and
  search; the `email` column was dropped; see BRIEF 2.4.
- Reservations (2026-10-28): `unit_price` was REMOVED (no price on a reservation, no deposit ceiling and no
  "remaining"; the price is agreed with the contract), `unit_type`/`unit_activity` are nullable for building-level
  reservations, and the general `PUT /reservations/{id}` endpoint is gone (cancel/convert only); see BRIEF 2.5.
- Contracts (2026-10-29): the screen model is in the API — `draft` status, free `schedule[]`, company `discount`,
  lease terms, `POST /contracts/{id}/post`, and list `search`/`sort`/`per_page` + `meta.counts` (per type, before the
  type filter). Cancelling a contract marks its installments `cancelled` (`InstallmentStatus::cancelled`, never deleted)
  and they stop being collectable; see DEFAULTS "Contracts screen model".
- Receipts (2026-10-29): the collection page is wired. `receipts` (number `R-YYYY-NNNNN` per year, contract,
  paid_at, method, reference, total, status) groups the payment lines through the nullable
  `installment_payments.receipt_id` / `contract_down_payments.receipt_id`, so one receipt covers several
  installments and/or part of the down payment. Endpoints:
  `GET /admin/receipts` (search/status/contract/client/method/date filters, sort, paging),
  `GET /admin/receipts/{receipt}`, `POST /admin/receipts`, `POST /admin/receipts/{receipt}/cancel`.
  Permissions reused: list/show = `contracts.view`, create = `payments.create`, cancel = `payments.cancel`.
  Only active contracts collect money — the guard sits in `InstallmentService::recordPayment`, so it covers the
  per-installment endpoint too. Cancelling a receipt cancels every line it created (reason kept, nothing deleted).
  `App\Enums\PaymentMethod` grew to `cash | bank_transfer | cheque | vodafone_cash | instapay | other` and is now
  the single source for the method lists (requests + the daily inventory split). See DEFAULTS "Receipts".
- Collections & bell (2026-10-29): `GET /admin/installments` and `GET /admin/down-payments` list every row of the
  **active** contracts. Both accept `search` (contract number, client name/phone, unit, building), `type`
  (`sale|rent`), `status` (`due|overdue|partially_paid|paid`), `due_on` (one day) or `from`/`to`, `sort`, `dir`,
  `page`, `per_page`. `meta.counts` describes the four display states (after the type filter, before status/day),
  `meta.type_counts` is counted **before** the type filter, and `meta.totals` carries amount/paid/remaining/overdue.
  The display status is recomputed against today (`overdue` wins over `partially_paid`); the stored
  `installments.status` is only refreshed when a payment is recorded. `GET /admin/installments/calendar?month=YYYY-MM`
  and `GET /admin/down-payments/calendar` return per-day totals (`total/overdue/due/paid`) for the month grid.
  A down-payment row is one per active contract with `agreed_down_payment > 0`, due on `contract_date`; its paid
  amount is the reservation deposit plus every valid down-payment receipt (SQL subquery that mirrors
  `Contract::paid_down_payment`, which now also uses the eager-loaded `downPayments` relation when available).
  `GET /admin/notifications` returns two groups — overdue and due-today — of unpaid installments on active contracts,
  each with its full count and at most 10 items. Everything here is read-only and needs `contracts.view`; money is
  still recorded through receipts. See DEFAULTS "Collection page & bell".
- Installments summary report (2026-10-29): `GET /admin/reports/installments-summary` powers «ملخص الأقساط والعقود».
  It lists every non-draft contract (drafts have no schedule) with `type` / `building_id` / `client_id` /
  `status` (`active|cancelled`) filters and returns per contract: `unit_price` (sale), `monthly_rent`,
  `security_deposit`, start/end dates (lease), down payment + remaining, deposit remaining, schedule
  `total_installments` / `paid_installments` (a row is collected when `remaining <= 0`), `installments_total`,
  `installments_paid`, `installments_remaining`, `contract_value` (sale price or whole schedule), `total_paid`,
  `total_remaining`, `current_installment_remaining`, and `last_paid_installment` / `next_due_installment` as
  `{sequence_number, due_date}` (new `Contract::lastPaidInstallment` / `firstOpenInstallment` `ofMany` relations,
  eager-loaded so the report stays query-per-relation). `meta.counts` is counted **before** the `type` filter.
  Read-only, needs `reports.sales`; see DEFAULTS "Installments summary report".
- Due & overdue report (2026-10-29): `GET /admin/reports/due-overdue` powers «الأقساط المستحقة والمتأخرة».
  It lists the unpaid installments of **active** contracts that are due today or already late (`remaining > 0`,
  `due_date <= today`) with `type` / `building_id` / `client_id` / `bucket` filters, and returns per row
  `contract_number`, `contract_type`, client, unit, building, `sequence_number`, `due_date`, `amount`,
  `paid_amount`, `remaining`, `days_overdue` and `bucket` (`0-30 | 31-60 | 61-90 | 90+`, a row due today lands in
  `0-30`). `meta.buckets` ({count,total} for `all` + the four buckets) counts the whole scope, so the bucket filter
  narrows the rows only; `meta.due_within_7_days` is the separate «يستحق خلال 7 أيام» figure (tomorrow → +7 days,
  same filters). The rows are returned whole (no paging) because the report is searched/sorted/exported client-side.
  Date bounds use `whereDate`, not a string comparison: SQLite stores the cast as `Y-m-d H:i:s` and would drop the
  rows due exactly today. Read-only, needs `reports.sales`; see DEFAULTS "Due & overdue report".
- Customer statement (2026-10-29): `GET /admin/reports/customer-statement` powers «كشف حساب عميل» — one client's
  reservations, contracts with their schedule, and every payment of the period, plus `totals` / `contract_totals` /
  `reservation_totals`. Payment lines carry `contract_id` + `contract_number` (the shared `paymentsQuery` /
  `cancelledPaymentsQuery` in `BaseReportService` now select them for all five report services; a reservation payment
  is `null` because the contract only exists after conversion). `totals.overdue` is the sum of the overdue installment
  remainders, not the whole contract remainder (it used to contradict its own comment). Cancelled payments are listed
  with `is_cancelled` + `cancel_reason` and summed into `totals.cancelled_payments`, never into `totals.paid`.
  Read-only, needs `reports.customer_statement`; 3 tests in `CustomerStatementTest`. See DEFAULTS "Customer statement".
- Building & unit statements (2026-10-29): `GET /admin/reports/building-statement?building_id&from_date&to_date`
  («كشف عقار») and `GET /admin/reports/unit-statement?unit_id&from_date&to_date` («كشف وحدة»), both read-only and
  needing `reports.building` / `reports.unit`. The building payload is `building` / `period` / `counts` (total +
  available/reserved/sold/rented/closed) / `units` / `floors` (per-floor money) / `contracts` / `reservations` /
  `totals`; the unit one is `unit` / `period` / `client` / `current_contract` / `current_reservation` /
  `reservations` / `contracts` (each with its `installments[]`) / `totals`.
  - **Only active contracts count.** Sales/remaining/due/overdue/rent come from active contracts; a cancelled contract
    is still listed (status + `is_active`) but never feeds a figure, because a cancelled schedule keeps its old
    `remaining` — the shared `BaseReportService::contractMoney()` filters `InstallmentStatus::CANCELLED` rows.
    Sale: value = `total_price`, paid = down payment (reservation deposit included) + schedule paid. Lease: value =
    the whole schedule, paid/remaining from the schedule only. `overdue` = past-due unpaid rows, `due` = unpaid rows
    due up to the end of the current month. Drafts never appear (a draft has no schedule).
  - `totals.collected` on the building is the **period's valid payments**, not `Σ contract.paid`; `totals.cancelled`
    is the period's cancelled payment lines; floor `collected` maps those payments by unit, and a building-level
    reservation payment lands on the building only. The unit statement's `deposit_paid` only counts the still-open
    reservation (a converted deposit already sits in the contract's paid down payment).
  - Unit statement: `current_contract` = the active contract, `current_reservation` = the active reservation,
    `installments[].paid_at` = the latest valid (non-cancelled, non-deleted) payment date of that row.
  - `BaseReportService::paymentsQuery` / `cancelledPaymentsQuery` apply their `client_id|unit_id|building_id|contract_id`
    filters inside **every** union branch (`withPaymentFilters()` + `PAYMENT_FILTER_COLUMNS`): a `where` after
    `unionAll()` only narrows the first select. `paymentsQuery` also returns valid, non-deleted rows only (cancelled
    lines were being double-counted). 4 tests each in `BuildingStatementTest` / `UnitStatementTest`. See DEFAULTS
    "Building & unit statements".
- Monthly revenue & daily collection (2026-10-29): `GET /admin/reports/monthly-revenue?from_date&to_date&building_id`
  («الإيرادات الشهرية», `reports.sales`) and `GET /admin/reports/daily-collection?from_date&to_date&building_id`
  («التحصيل اليومي», `reports.daily_inventory`) report **collected money**, not contract values.
  - Monthly: `months[]` with `month` (`Y-m`), `payments`, `receipts` (distinct receipt numbers), `reservations` /
    `down_payments` / `installments`, `total`, `cancelled` and `cumulative`; money is keyed by `paid_at`'s month and a
    cancelled line by `cancelled_at`'s month (never inside `total`); `cumulative` restarts at the period. `totals`
    sums the same fields.
  - Daily: `summary` (`collected` / `cancelled` / `net` / `lines` / `receipts` / `days`), `by_type`, `by_method`
    (present methods only), `by_day`, `payments[]` and `cancelled_payments[]` (with `cancel_reason`). Each line names
    its receipt, contract (`contract_number` / `contract_type`), installment (`sequence_number`), client, unit and
    building; all of those are `null` on a reservation payment.
  - The extra names live in the shared `BaseReportService::paymentsQuery` / `cancelledPaymentsQuery` (left joins to
    clients/receipts, plus units/buildings for the reservation branch), so the statements and the customer statement
    select them too. `cancelled_at` is filtered with `whereDate` — a string bound dropped cancellations made on the
    last day of the period.
  - 4 tests each in `MonthlyRevenueTest` / `DailyCollectionTest`. See DEFAULTS "Monthly revenue & daily collection".
- Unit status report (2026-10-29): `GET /admin/reports/unit-status?building_id&floor_id&type&purpose` powers «حالة الوحدات».
  Read-only, needs `reports.unit`, audit-logged as `unit_status`. It returns `counts` (total + available/reserved/sold/
  rented/closed), `totals` (units, area, sale_area, sale_value, monthly_rent), `by_building[]` (the same figures per
  building) and `units[]` (each unit with its building, floor, type, purpose, area, listed `sale_price`, state, the
  active contract / reservation it sits on, and the client). `closed` = `is_sellable = false` **and** `available`
  (same rule as the statements); there is no «مرتجعة» bucket — a cancelled contract gives the unit back as `available`.
  The money follows the state: a sold unit is worth its active contract's `total_price`, an available/reserved/sold
  unit its `sale_price` (`sale_price` column, null for rent-only), a rented one its active lease's `monthly_rent`.
  4 tests in `UnitStatusTest`. See DEFAULTS "Unit status report".
- Deletion (2026-10-30, decided by the owner): `DELETE /admin/buildings/{id}` and `DELETE /admin/units/{id}` are a
  **permanent cascade** — the building goes with its floors/units, the unit with its reservations/contracts, and each
  contract with its installments, down payments, receipts and payment lines (`App\Services\Units\UnitTreeDeleter`).
  The response returns `data.deleted` counts, one audit entry keeps the old values plus `meta.deleted`; the old
  "blocked while it has units / a live deal" guards are gone (BRIEF 2.1/2.3). Clients are never touched by a
  building/unit delete, but `DELETE /admin/clients/{id}` cascades the same way (their reservations/contracts and
  money) and sends the now-free units back to `available` (`UnitService::releaseUnits`, `units_released` in the
  response) — BRIEF 2.4. 3 tests in `DeletionCascadeTest`. See DEFAULTS "Cascade deletion".
- Test suite: 186 Pest tests, all green.
- Known gaps: `ReportsController::export` is still a stub (`export_url: null`); reports do not yet include the
  project name in their headers.

## Architecture
- Controllers are thin: authorize -> FormRequest -> Service -> Resource.
- Business logic lives only in `app/Services/**`. Models hold relations, casts, accessors.
- `app/Support/`: `Money` (brick/math BigDecimal, scale 2), `Text/ArabicNormalizer`, `Text/PhoneNormalizer`,
  `Clock` (inject it; never call `now()`/`Carbon::now()` directly in domain code).
- Enums: PHP backed enums in `app/Enums`, cast on models, labels via `lang/{ar,en}/enums.php`.
  Call `__("enums.group.{$value}")` — the 3rd argument of `__()` is the LOCALE, not the file, so never pass a
  group name there (it silently falls back to English). Use `__('key', locale: 'ar')` only to force a locale.
- Permissions: fixed `App\Enums\Permission` enum. Roles are stored in the DB; `role_permissions` stores enum values.
  Admin role = all permissions, always. One role per user. Enforced via Policies/Gates in the API.
- Single project: there is no `projects` table. The project's name/address live in `settings`
  (`project_name`, `project_address`), managed via `GET/PUT /api/v1/admin/settings` (`settings.view` / `settings.update`).
- Every multi-step write goes through `Operation::run()` (DB transaction + operation_id + audit).

## Non-negotiable rules
- Money: `DECIMAL(14,2)`; PHP uses string/BigDecimal, never float. All money math goes through `MoneyCalculator`.
- Never hard-delete financial data. Financial items are cancelled with a reason; others are soft-deleted under the brief's guards.
  The one exception is the owner-decided permanent building/unit cascade delete (BRIEF 2.1/2.3).
- Unit status is automatic (reservation/contract operations only); there is no API to set it.
- Contract financial fields and installment schedules are immutable; only notes are editable.
- Installment `paid_amount`/`remaining`/`status` are updated ONLY by `InstallmentLedgerService`,
  in the same transaction as the payment create/cancel. "Overdue" is computed at read time, never stored.
- Rounding difference goes to the LAST installment. Month-end clamps without drifting.
- Concurrency: lock the unit row (`lockForUpdate`) for reservation/contract operations, plus DB-level guards.
- Optimistic locking: updates must send `lock_version`; a mismatch returns 409.

## Audit log
- Table `audit_logs` is append-only: no update/delete code paths, plus MySQL triggers that reject UPDATE/DELETE.
- Written in the SAME transaction as the operation. If logging fails, the operation fails.
- Automatic side effects are logged with `is_automatic = true` and the parent `operation_id`.
- Installment generation = ONE summary entry.
- Rejected operations and failed logins are logged in a separate transaction (the main one rolled back).
- NEVER log passwords, tokens, or secrets. Redact sensitive fields for non-admin viewers.
- No foreign keys on `audit_logs`; PK `(id, occurred_at)` so monthly partitioning stays possible.

## API conventions
- Success: `{ "data": ..., "meta": ... }`. Lists paginate with `page`, `per_page`, `sort`, `filter[...]`, `search`.
- Business-rule violation: 422 `{ "code": "unit.already_reserved", "message": "<translated>" }`.
- Locale from `Accept-Language` (ar default, en secondary). All messages translatable.
- Code, tables, columns, and enum values are in English; user-facing text is in Arabic.

## Testing
- Default suite runs on SQLite `:memory:`; MySQL-specific behavior (audit triggers, `lockForUpdate` semantics,
  truly concurrent requests) is not exercised there — verify it against `arp_sys_test` when it matters.
- Every business rule needs at least one test, including negative tests that try to break it.
- Freeze time with `FrozenClock`, never with real dates.
- Concurrency tests (e.g. two simultaneous reservations) must yield exactly one success.
- `system:test` must abort unless the DB name matches `*_test`/`test_*`, APP_ENV != production,
  and host/DB differ from production. External services (mail/SMS/cloud) are always faked there.

## Out of scope (do not build)
Dashboard, governorate, detailed address, auto unit generation, rent price on units, late fees,
interest, annual rent increase, renewals, per-project scoping, multi-currency, public listings.
The `front/` prototype has Maintenance, Owner Unions, and Renewal screens; ignore them unless told otherwise.

## Git
- No commits, pushes, or PRs unless explicitly asked.
- Never commit `.env`, backups, keys, or anonymized data dumps.
