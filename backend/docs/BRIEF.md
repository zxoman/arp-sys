# Real Estate Management API (Laravel) — Project Brief

**Source of truth.** Where it says "DECIDED", follow strictly. Where it says "DEFAULT (unconfirmed)", implement the default but keep it easy to change and list it in `docs/DEFAULTS.md`. Never invent business rules that are not here; if something is missing, ask.

---

## 0. Working Instructions

- Stack: Laravel 11/12, PHP 8.2+, API-only (`routes/api.php`), Laravel Sanctum, MySQL (DEFAULT, unconfirmed; keep portable), Redis queues optional.
- UI language is Arabic (RTL clients). Validation messages and enums must be translatable (ar as primary, en as secondary). Code, tables, and columns are in English.
- Use: Form Requests, API Resources, Policies/Gates, Service classes for business logic (controllers stay thin), PHP backed Enums with model casts, soft deletes, Pest or PHPUnit.
- Money: DECIMAL(14,2), never float. All money math in one place (a Money/Calculator service).
- Build in the phases listed in section 14. At the end of each phase: run the tests, summarize what was built, list assumptions, and wait for confirmation before the next phase.
- Every business rule below must have at least one automated test, including negative tests that try to break it.

---

## 1. Domain Hierarchy

Building -> Floor -> Unit. The Project entity was REMOVED (2026-10-27 decision: the company runs a single project). There is no projects table and no project_id anywhere.
Client -> Reservation -> (optionally) Contract -> Installments. Payments live in three separate tables.

---

## 2. Entities and Rules

### 2.1 Project (مشروع) — REMOVED (2026-10-27)
- The projects table, endpoints, permissions, and project_id columns were removed. The system serves one single project; there is no multi-project dimension.
- Consequences: the project statement report was removed; sales and daily-inventory breakdowns are by building instead of by project.
- The single project's name and address are stored ONCE in the `settings` table (keys `project_name`, `project_address`), seeded empty and edited via `GET/PUT /api/v1/admin/settings` (permissions `settings.view` / `settings.update`). There is no projects CRUD.

### 2.2 Building (عقار)
Standard add-building form (2026-10-27): name, city, district, type, activity, floors_count, total_units, has_basement.
- name (required).
- city, district: required free text. Autocomplete from existing buildings. District without city is allowed.
- type: required, fixed enum (عمارة=building, برج=tower, بيت=house, مبنى مكاتب=office_building).
- activities: MANY-TO-MANY, fixed enum values: residential (سكني), administrative (إداري), commercial (تجاري), medical (طبي), hotel (فندقي). At least ONE required, no duplicates. There is NO "mixed" value.
- floors_count: required, number of floors EXCLUDING basement.
- total_units: required, the planned/declared number of units in the building (planning value only, NOT enforced against registered units).
- has_basement: boolean (default false).
- Optional extras (not in the standard form): number (string, e.g. "12A", unique), area (decimal > 0), units_per_floor (planning value).
- NO governorate field. NO detailed address field.
- Autocomplete: when typing city/district, suggest values already used on other buildings (suggestions come from the buildings table itself; no separate cities/districts tables). District suggestions are filtered by the chosen city when a city is present. Normalize Arabic for comparison only (trim, collapse spaces, ignore hamza variants, taa marbouta/haa, alef maqsura/yaa). If a normalized match exists, store the already-stored spelling.
- Floors (auto-generated, same transaction as building creation):
  - If has_basement: floor 0 (basement). Then floors 1..floors_count. Floor 1 is the first floor above the basement (no separate "ground" floor). Example: 5 floors + basement = floors 0..5.
  - Display names (presentation only): 0 = "بدروم", 1 = "الأول", 2 = "الثاني", ...
  - Increasing floors_count adds floors. Decreasing is blocked if the removed top floors have units. Adding a basement creates floor 0; removing it is blocked if it has units.
  - Removing an activity from a building is blocked if units use it. The last remaining activity cannot be removed.
  - Delete: a PERMANENT cascade (owner, 2026-10-30) — the building goes with its floors, units, reservations (and their deposits), contracts (and their schedule, receipts and payments). No guard blocks it.
  - Floors have no standalone CRUD pages; they appear inside the building.

### 2.3 Unit (وحدة)
DECIDED:
- building_id (immutable after creation), floor_id (must belong to the same building), name, type (fixed enum: شقة=apartment, محل=shop, مستودع=warehouse, استوديو=studio), activity (SINGLE value chosen from the building's activities; auto-set if the building has only one), area > 0, price_per_meter, rooms, bathrooms, status.
- purpose (الغرض): enum sale | rent | both (بيع / إيجار / بيع وإيجار), default `both`. Enforced at reservation and contract creation: a rent-only unit cannot be sold and a sale-only unit cannot be rented (`both` = unrestricted).
- is_sellable (غير قابلة للبيع): manual boolean, default true. When false, a `non_sellable_reason` is REQUIRED (e.g. نزاع قضائي، مرهونة). «غير قابلة للبيع» blocks BOTH sale and rent (it means the unit is off the market), and blocks new reservations too.
- is_sellable is a separate flag from status, NOT a status value: status keeps its automatic meaning (متاحة / محجوزة / مباعة / مؤجرة), and the UI shows the "غير قابلة للبيع" label + reason derived from the flag.
- sale_price (سعر البيع): nullable DECIMAL(14,2) > 0, overrides area x price_per_meter when set. Not allowed on a rent-only unit (rejected, and switching a unit to rent-only clears it).
- total price = sale_price when set, otherwise area x price_per_meter, otherwise null (rent-only). COMPUTED (accessor), never stored.
- Units are created manually (no auto-generation).
- status enum: available, reserved, sold, rented. Maintained AUTOMATICALLY by reservation/contract operations. No manual status editing via API.
- Only one active contract per unit at a time. A sold unit cannot be re-sold. A rented unit returns to available when its contract ends/cancels.
- No rent price field on the unit; rent value is entered at contract time. A rent-only unit has no sale price, so a reservation on it requires the reference price to be entered manually.
- Editing area/price_per_meter blocked when the unit is sold. Past reservations/contracts keep their own frozen prices.
- purpose, sale_price, is_sellable and non_sellable_reason are LOCKED once the unit is sold or rented (same guard as area/price_per_meter); they stay editable while available/reserved. Sending the same values is allowed.
- Delete: a PERMANENT cascade (owner, 2026-10-30) — the unit goes with its reservations (and deposits) and contracts (and their schedule, receipts and payments).
DEFAULT (unconfirmed):
- Unit name unique within a building.
- price_per_meter required.
- rooms and bathrooms: nullable unsigned integers, 0 allowed, null = not specified, sane max (e.g. 20). "Rooms" meaning (bedrooms vs total) unconfirmed: name the column `rooms` and document it.
- Additional unit types (office, clinic, hotel room) NOT added yet; keep the type list in one enum so it is trivial to extend.

### 2.4 Client (عميل)
- Fields: name (required, not unique), phone (string), phone_2 (optional second number).
- Phones normalized before saving (strip spaces/dashes, convert Arabic-Indic digits to ASCII, consistent international format).
- Duplicate phone: WARN, do not block (DEFAULT, unconfirmed), checked across both numbers. Two phone columns max (DECIDED 2026-10-28); a third number needs a schema change.
- There is NO email field on clients (removed 2026-10-28). Extra fields (national id, notes) can still be added later.
- Search by name or phone, Arabic-normalized.
- Soft delete blocked if the client has an active reservation or any contract.

### 2.5 Reservation (حجز)
DECIDED:
- client_id (required), building_id (nullable), unit_id (nullable), unit_type, unit_activity, reservation_date, status (enum: active, converted, cancelled), cancelled_at, cancellation_reason.
- There is NO price on the reservation: the agreed price is entered with the contract (sale or rent), and deposits are only recorded as amounts.
- There is NO "purpose" (sale/rent) field on the reservation. Sale vs rent is chosen only at contract time.
- Two levels: building-level or specific unit. A unit without a building is impossible (building is derived from the unit). When a unit is set, building, type, and activity are taken from the unit (ignore client-sent values). Activity must be one of the building's activities.
- Unit type and activity are copied from the unit when one is set. A building-level reservation has no unit to copy them from, so both stay NULL.
- The unit must be sellable (is_sellable = true) to be reserved; «غير قابلة للبيع» units are rejected.
- A general reservation can later be assigned a unit: the unit must be available and match type and activity.
- Only ONE active reservation per unit (enforce with a transaction + row lock on the unit, plus a validation check; add a DB-level guard where the engine allows).
- Status transitions: active -> converted | cancelled. converted and cancelled are final. Adding payments and cancelling payments are allowed only while active. There is no general "edit reservation" endpoint (the only former editable field was the price).
- Unit status: active reservation on a unit -> reserved; cancel -> available; convert -> sold or rented depending on the contract type.
- Reservation payments (table reservation_payments): reservation_id, amount > 0, paid_at, payment_method (nullable), notes/reference, status (valid/cancelled), cancel_reason, cancelled_at. NEVER hard-deleted; cancelled with a reason. "Deposit paid" is COMPUTED as the sum of valid payments (no stored deposit column). A first payment may be created together with the reservation. Because the reservation has no price, there is no ceiling on the sum of deposits and no "remaining" value. `paid_at` is optional on create and defaults to today when omitted.

### 2.6 Contract (عقد)
DECIDED:
- type: sale or rent (required, immutable after creation).
- reservation_id: OPTIONAL. If chosen (active reservations only): client and unit are auto-filled and LOCKED; the price is entered with the contract (no suggested price comes from the reservation); if the reservation has no unit yet, the unit must be assigned first (must be available). If no reservation: all fields are entered manually.
- A direct contract (no reservation) on a unit that has an active reservation is BLOCKED (the reservation must be converted instead).
- client_id and unit_id are required directly on the contract in both cases.
- The unit's purpose and sellability are ENFORCED at creation: a sale contract needs a unit that offers sale (purpose sale/both), a rent contract needs one that offers rent (rent/both), and a unit with is_sellable = false rejects BOTH (the unit is off the market).
- One reservation -> at most one contract.
- contract_date, total price (or rent value), agreed down payment (مقدم), installments_count, first_installment_date, interval_months (collect every N months: 1 monthly, 3 quarterly, 12 yearly, free integer), notes, status (active, cancelled), cancelled_at, cancellation_reason.
- Creating the contract is ONE atomic transaction: create the contract, generate installments, update reservation status (converted) if any, update unit status (sold or rented). All or nothing.
- Down payment: the agreed down payment INCLUDES reservation payments. Paid down payment = reservation payments (if from a reservation) + contract down-payment payments. Remaining down payment = agreed - paid. Agreed down payment must be >= reservation payments and <= price. Down-payment payments are FREE-FORM (any amount, any time) until complete; their sum may not exceed the agreed down payment. Reservation payments stay in their own table linked to the reservation and are never copied or counted twice.
- Installments are NOT blocked by an incomplete down payment: they follow their fixed schedule; incomplete down payment is tracked alongside.
- Installment amount = (price - agreed down payment) / installments_count. Rounding difference goes to the LAST installment so the sum equals the remainder exactly. If installments_count = 0: no installments, start date and interval not required. If > 0: start date and interval required. Month-end handling: if the start day does not exist in a later month, use that month's last day (without drifting afterwards). Max count e.g. 360.
- A schedule PREVIEW endpoint computes installments without saving.
- Financial fields and the installment schedule are IMMUTABLE after creation. Corrections = cancel the contract and create a replacement. Notes are editable.
- Cancelling a contract: requires a reason; unit returns to available. What happens to money already paid: see section 12 (unconfirmed).
- Never hard-delete; soft delete blocked if any payment was made. (The only exception is the owner-decided building/unit cascade — see 2.1/2.3.)
DEFAULT (unconfirmed):
- Contract number auto-generated, sequential per year (e.g. 2026-0001), unique, generated race-safely.
- Start date may not be before contract date unless the user has a special permission (to allow back-dated old contracts later, make it a single rule).
- Rent: same structure as sale with different labels (agreed down payment = deposit/advance, installments = periodic rent payments, rent term derived from count x interval). No refundable-deposit logic, annual increase, or renewal yet.

### 2.7 Installment (قسط)
DECIDED:
- contract_id, sequence number, due_date, amount (fixed, never changes), paid_amount, remaining, status (due, partially_paid, paid).
- paid_amount, remaining, and status are STORED for fast filtering and updated automatically in the same transaction as any payment create/cancel. No manual edits. A single service is the only place that updates them.
- "Overdue" is COMPUTED at read time (due_date passed AND remaining > 0), never stored as a status.
- An unpaid remainder does NOT carry over to the next installment: each installment stays independent with its own amount; a partially paid installment shows "paid X, remaining Y".
- Installments are never deleted; they are cancelled together with the contract.

### 2.8 Payments: three SEPARATE tables (DECIDED)
1. reservation_payments (linked to reservation)
2. contract_down_payments (linked to contract)
3. installment_payments (linked to contract AND installment)
Each has: amount > 0, paid_at, payment_method (nullable), notes/reference, status valid/cancelled, cancel_reason, cancelled_at, created_by. No hard delete. Shared rules are implemented once (trait/base class).
- Installment payment: the user picks the installment (default suggestion: oldest installment with a remaining balance); amount may not exceed that installment's remaining balance.
- Combined money views (daily inventory, client statement) use a UNION/DB view over the three tables.

---

## 3. Users, Roles, Permissions (DECIDED unless noted)
- Users: name, login identifier (unique), password (hashed, never shown or logged), phone (optional), status active/suspended, last_login_at. No self-registration; only admins create users. No hard delete (suspend or soft delete). Suspending revokes tokens immediately. Failed logins are logged; lock temporarily after 5 failures. Last remaining admin can never be deleted or suspended.
- Roles are editable at runtime (stored in DB). Permissions are FIXED in code, per entity: view, create, update, cancel/delete; plus sensitive standalone permissions: convert reservation to contract, cancel reservation, cancel contract, cancel payment, override price vs reservation price, view customer statement and financial reports, export reports, view audit log, manage users, manage roles, manage backups.
- Admin role always has all permissions. Nobody can grant permissions they do not hold. A role linked to users cannot be deleted. Role/permission changes are audited with old/new values.
- Permissions are enforced in the API (not only hidden in the UI).
DEFAULT (unconfirmed): login by username or email; one role per user; no per-user data scoping yet; no "responsible salesperson" field yet, only created_by on reservations, contracts, and payments.

---

## 4. Audit Log (DECIDED)
- One append-only table: timestamp (microsecond precision), user_id (or "system"), action type (create, update, delete, restore, cancel, convert, login, logout, login_failed, export, rejected_operation...), entity type and id, old values, new values, changed fields, IP, user agent, endpoint, reason/notes, operation_id (groups all changes of one business operation, e.g. contract creation).
- Never updated or deleted. Enforce at DB level where possible (insert/select-only DB grants or triggers) and in code (no update/delete paths).
- Written in the SAME transaction as the operation: if logging fails, the operation fails.
- Automatic changes (e.g. installment status after a payment, unit status) are logged and flagged as automatic with the parent operation_id.
- Installment generation is logged as ONE summary entry (not N rows).
- Rejected operations (e.g. overpayment) and failed logins are logged.
- Reads: log only sensitive reads (customer statement, financial reports, exports). DEFAULT (unconfirmed).
- NEVER log passwords or tokens. Hide sensitive fields from log views for non-admins. View permission: admin only. Index on date, user, entity. Plan for monthly partitioning. Keep forever (DEFAULT, unconfirmed).
- Each detail screen has a "history of this record" tab.

---

## 5. Pages and Operations (API surface to implement)
(No dashboard page. The dashboard was explicitly removed. Default landing page after login is permission/role based; unconfirmed.)
1. Auth and profile: login, logout (revoke token), view/update own name and phone, change password (requires the old one; revokes other sessions).
2. Buildings: list (filter by type, activity, city, district), create (activities, basement, autocomplete, auto floors), update (rules in 2.2), details (floors with units, planned vs registered), permanent cascade delete (2.1), suggestions endpoint, history.
3. Units: list (filter by building, floor, type, activity, status, purpose, sellable), create, update, details (status, current reservation/contract, history), permanent cascade delete (2.3), no manual status change, history.
4. Clients: list/search, create (duplicate phone warning), update, profile (reservations, contracts, installments), soft delete, history.
5. Reservations: list (filter by status, building, client), create (optionally with first payment), assign unit, add/cancel payment, cancel reservation (reason), "convert" action (returns pre-filled data for the contract screen; the contract is created via the contracts endpoint), details (payments, deposit paid), history. No price and no general edit endpoint.
6. Contracts: list (filter by type, status, client), create (with optional reservation, schedule preview, atomic save), add/cancel down-payment payment, record installment payment, cancel installment payment, cancel contract (reason), details (data, down payment and payments, installments, statement), history. No edits to financial fields.
7. Collection (التحصيل): all installments across contracts (filter by status incl. overdue, date range, client, building), record payment, open contract/client, export.
8. Reports (read-only, export Excel and PDF; every export is logged; each report has its own permission): customer statement, building statement, unit statement, sales report, DAILY FINANCIAL INVENTORY (see section 6). Common rules: date range filter; header with entity, issue date, issuing user, period; cancelled items shown but flagged and excluded from totals.
9. Admin: users (CRUD, suspend/activate, reset password, change role), roles and permissions, settings (single project name/address), audit log (filter by user/date/type/entity, detail with old/new, export), backups page (section 8).

Cross-cutting: pagination/search/filter/sort on lists; cancellation with reason instead of delete for anything financial; optimistic locking (updated_at/version check) to prevent silent overwrites (DEFAULT, unconfirmed); every write permission-checked and audited in the same transaction.

---

## 6. Reports
- Customer statement: client data, reservations, contracts (agreed vs paid vs remaining down payment), installments (due date, amount, paid, remaining, status, overdue flagged), all payments in chronological order across the three tables, totals (required, paid, remaining, overdue). Formal printable layout vs internal-only is unconfirmed (build internal first).
- Building / unit statements: financial and detailed (what was sold or rented, paid, remaining, overdue), breakdowns per child entity; unit statement includes full history of reservations and contracts including cancelled.
- Sales report: filters (period, building, unit type, activity, contract type, creating user); counts and totals (contract value, down payments, collected, remaining); grouping by building/type/activity/month; reservations section with conversion rate; average price per meter. Sale and rent in ONE report with a type filter (DEFAULT). Show both "contract value" and "collected" side by side (DEFAULT).
- Daily financial inventory (الجرد اليومي, "how much do we have today"): it is a MONEY report, not unit inventory. Collected today split by reservation / down payment / installments, by payment method, by building; cancelled payments shown separately and deducted; cumulative balance; expected (installments due today, overdue count and total, expected this week/month, incomplete down payments, total remaining on all contracts); per-payment detail list (time, client, unit, type, amount, method, user). Based on payment date, not entry date (back-dated entries flagged). Pick any past date. Open questions (cash/bank/cheque split, cumulative from system start vs year start, expenses/refunds, day-closing) are in section 12.

---

## 7. Integrity Rules (apply everywhere)
- Money columns decimal; sums validated server-side; no stored value may contradict its source (installment paid/remaining/status must always equal the sum of valid installment_payments).
- All multi-step operations in DB transactions; concurrency-safe (two simultaneous reservations on one unit must result in exactly one success).
- Time must come from an injectable clock so overdue/closing logic is testable.

---

## 8. Automatic Backup (DECIDED unless noted)
- Scheduled job every 30 minutes: dump the full database with deterministic settings (no volatile timestamp header, stable ordering) -> compute hash -> compare with the last stored backup's hash.
  - Same hash: delete the temp file, record "checked, no change".
  - Different: save as backup_YYYY-MM-DD_HH-MM-SS (compressed, encrypted), store its hash.
- Delete backups older than 10 days automatically, but ALWAYS keep the latest successful backup even if older. Never delete anything in a cycle where the new backup failed.
- Prevent overlapping runs (lock). Verify file integrity after creation. Log every backup, skip, and deletion in the audit log; alert admins on failure.
- Backup log table: timestamp, filename, size, hash, status, duration, plus entries for no-change checks.
- Admin page: list backups, last check, last success, download (special permission, logged), run manual backup now. Restore is NOT available from the UI; only via a restricted CLI command.
- DEFAULT (unconfirmed): store copies off the server as well (cloud/second server); consider MySQL binary logs for point-in-time recovery; consider tiered retention; weekly automated restore test into an isolated environment. Alert channel and encryption key owner are undecided.

---

## 9. One-Command System Test (DECIDED concept)
A single artisan command (e.g. `php artisan system:test`) with `--quick` (fixed seeded data, minutes) and `--full` (restored copy of real data):
1. Create an isolated test environment: separate database (ideally a separate server), separate file storage, dedicated .env.testing, external services (mail, SMS, cloud storage) disabled or faked.
2. SAFETY GUARD: abort immediately if the target DB name/host does not clearly identify a test database or if it points at production.
3. For --full: restore the latest backup (read-only access to the real system) into the test DB, then ANONYMIZE: replace client names/phones with fake data, reset all user passwords to a known test value, remove tokens. Never send any notification to real people.
4. Simulate real users via real HTTP requests to the API (login with tokens, real permissions, real validation), per role. Browser automation is added later if a frontend exists.
5. Run user journeys: full sale (building -> floors auto-created -> units -> client -> reservation with payment -> second payment -> convert to contract -> preview -> save -> partial installment payment -> pay the rest, verifying numbers and statuses at every step); direct contract without a reservation; rent; cancellations (payment, reservation, contract, unit returns to available); reports compared against an independent calculation; admin journey (user, role, permissions, suspend).
6. Negative/rule tests that try to break every rule (double active reservation incl. truly concurrent requests, overpayment, editing an immutable contract, deleting a building with units, floor from another building, permission violations at API level, repeated failed logins, etc.).
7. Real-data checks (--full): integrity scan (sold unit without contract, installment sums mismatch, payment caps exceeded, active reservation on sold unit, paid > amount), performance on real volume, running pending migrations on the copy before production.
8. Output: summary (total/passed/failed/time), per-failure details (journey, step, expected vs actual, request/response, entity data), screen + saved report file (HTML/JSON) with timestamp, exit code 0/1 for CI. Option to keep the environment after failure and a command to reproduce a failed scenario. Nothing is ever pushed from test to production automatically.
- Also intended to run automatically before deployments (blocking on failure) and on a weekly schedule against fresh data (to be confirmed).

---

## 10. Technical Notes
- Normalize Arabic text and phone numbers in one shared helper.
- Provide seeders with a small fixed dataset covering every state (available/reserved/sold/rented, all reservation and contract statuses, paid/partial/due/overdue installments).
- Provide a Postman/OpenAPI description of the API.

---

## 11. Explicitly Out of Scope (for now)
Dashboard page, governorate, detailed address, automatic unit generation, rent price on units, late fees, interest, annual rent increase, renewals, multi-currency, public listings.

---

## 12. Open Questions (use the stated DEFAULT, flag clearly in code and docs)
- Overpaying an installment: DEFAULT reject (user records two payments). Alternative: auto-split to following installments.
- Money fate when a reservation or contract is cancelled (refund / deduct / forfeit; record refund as a separate transaction?): DEFAULT keep payments recorded, mark cancelled with the reason, no automatic refund logic; ask before building refunds.
- Late fees on overdue installments: DEFAULT none.
- Rounding difference location: DECIDED last installment.
- Extra payments (handover / annual lump sums) and unequal installments: DEFAULT not supported; equal installments only.
- Daily inventory: payment-method split (DEFAULT fixed list: cash, bank transfer, cheque, other), cumulative base (DEFAULT since system start), expenses (DEFAULT collections only), manual day-closing (DEFAULT view only, no closing).
- Report currency: DEFAULT single currency, configurable symbol.
- Customer statement: DEFAULT internal layout.
- Post-login landing page: DEFAULT role-based.
- Optimistic locking: DEFAULT on.
- Test environment location and anonymization: DEFAULT same server with a separate database; anonymization ON.

---

## 13. Deliverables per Phase
Migrations, models with relationships/casts, enums, services, form requests, policies, API resources, routes, seeders, tests, short README section. Keep naming consistent with this brief.

---

## 14. Build Order
1. Foundation: project setup, auth (Sanctum), users, roles/permissions, audit log infrastructure (used by everything), shared helpers (money, Arabic normalization, clock), test environment and the guarded system:test skeleton.
2. Buildings (+ activities, floors auto-generation, autocomplete) -> Units.
3. Clients.
4. Reservations + reservation payments.
5. Contracts, installments schedule generator + preview, down-payment payments, installment payments, collection screen.
6. Reports (customer, building, unit, sales, daily financial inventory) + exports.
7. Backup system + admin backups page.
8. Complete system:test (--quick and --full), integrity scans, performance checks.
