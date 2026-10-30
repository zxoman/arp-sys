# Defaults (unconfirmed decisions)

Catalog of every decision that is NOT confirmed by the owner yet. Each entry is the DEFAULT we implemented
so the system stays usable; each one must stay easy to change. The source of truth is `docs/BRIEF.md`
(a `DEFAULT` line there); this file tracks the concrete value in code and where to change it.

Rule: if a real business rule is missing from the BRIEF, ask — do not add it here.

---

## Units (BRIEF 2.3)

| Default | Implemented value | Where to change |
|---|---|---|
| `purpose` default for new units | `both` (بيع وإيجار) = no restriction | `StoreUnitRequest` / `UnitService::resolvePurpose`, column default in the migration |
| `is_sellable` default | `true` | migration default + `UnitService::create` |
| Reason is mandatory when not sellable | required, trimmed, max 255, cleared when the unit becomes sellable again | `UnitService::resolveNonSellableReason` |
| «غير قابلة للبيع» scope | blocks **both** sale and rent, and new reservations (matches the front prototype) | `ContractService::assertUnitOfferedFor`, `ReservationService::create` |
| Unit name unique within a building | NOT enforced yet (still open) | add a rule in `StoreUnitRequest`/`UnitService` when confirmed |
| `sale_price` semantics | overrides `area × price_per_meter`; rejected on rent-only units and cleared when switching to rent-only | `Unit::getTotalPriceAttribute`, `UnitService` |
| Locking | `purpose`, `sale_price`, `is_sellable`, `non_sellable_reason` frozen once status is `sold`/`rented` | `UnitService::assertPurposeAndSaleFieldsUnlocked` |
| Price of a «غير قابلة للبيع» unit | still reported (`sale_price ?? area × price_per_meter`) as a reference value; the flag only gates reservations/contracts. Say if it must read as empty instead | `Unit::getTotalPriceAttribute` |
| `price_per_meter` required | NOT enforced (nullable), because a rent-only unit may have no sale price | `StoreUnitRequest` |
| `rooms` / `bathrooms` | nullable integers, 0 allowed, max 20 | `StoreUnitRequest` / `UpdateUnitRequest` |
| Extra unit types (office, clinic, hotel room) | not added; one enum only | `app/Enums/UnitType.php` |

## Buildings (BRIEF 2.2)

- Building `number` is optional and unique when present; `area`, `units_per_floor` are optional extras.
- `total_units` is a planning value only and is NOT enforced against registered units.
- `has_basement` default `false`; decreasing `floors_count` is blocked when the removed top floors hold units.

## Clients (BRIEF 2.4)

- Duplicate phone: warn, never block (the warning travels in the create/update response); both `phone` and `phone_2` are checked.
- Two phone columns max: `phone` + `phone_2` (optional). A third number needs a schema change.
- Phone normalization: strip spaces/dashes, Arabic-Indic digits -> ASCII, normalized before saving (both numbers).
- `national_id`, `notes` exist but are optional and not part of the standard form. Clients have no email field.
- A client with an ACTIVE reservation or ANY contract (even cancelled) cannot be soft-deleted (BRIEF 2.4, literal).

## Reservations (BRIEF 2.5)

- Reservations carry no price (`unit_price` was removed on 2026-10-28): deposits are recorded as amounts with no ceiling and no "remaining"; the price is agreed with the contract.
- Only one ACTIVE reservation per unit (transaction + `lockForUpdate` + DB guard where the engine allows).
- Cancelling keeps payments recorded; no automatic refund logic.

## Contracts / installments (BRIEF 2.6, 2.7, 2.8)

- Contract number: sequential per year, `YYYY-NNNN`, generated race-safely.
- Installments are equal; the rounding difference goes to the LAST installment; month-end clamps to the month's last day.
- Overpaying an installment is rejected (record two payments instead).
- Installments are not blocked by an incomplete down payment.
- Start date before the contract date: not specially restricted yet (single rule to tighten later).
- Rent uses the same structure as sale with different labels (no refundable deposit / annual increase / renewal).
- **Contracts screen model (2026-10-29, unconfirmed):** added `draft` status (a draft keeps its schedule and
  changes nothing else), a free `schedule[]` (any dates/amounts; the screen's «توزيع» is only a helper),
  `discount` + `discount_reason` on a sale (`total_price` is the net price, the list price is total + discount),
  and lease columns `monthly_rent`, `duration_months`, `start_date`, `end_date`, `security_deposit`,
  `advance_months`, `annual_increase_pct`, `increase_from_year`.
  - `end_date` = start + months − 1 day (last covered month).
  - A lease posted without a schedule is generated as one row per month at `monthly_rent`; the yearly
    increase is applied only when the caller sends an explicit schedule.
  - A schedule row marked `is_down_payment` is not an installment: it is used for the printed schedule and,
    when it carries `paid_amount`, creates a down-payment payment.
  - `paid_amount` on a normal row creates an installment payment dated on the contract date (method empty).
  - The schedule total is NOT forced to equal price − down payment (the screen only warns).
  - Cancelling a contract keeps its installments (never deleted) marked `cancelled` (new
    `InstallmentStatus::cancelled`); they are no longer collectable and are excluded from "expected"
    figures in the daily inventory report. They also never count as overdue.

- **Receipts / collection page (2026-10-29, unconfirmed):** one receipt (إيصال قبض) is ONE collection act
  with one number (`R-YYYY-NNNNN`, per year), one date, one payment method, one reference and one total,
  covering **several installment payments** and **optionally part of the down payment**.
  - New table `receipts`; `installment_payments.receipt_id` and `contract_down_payments.receipt_id` group the
    lines (both nullable — payments made before receipts, e.g. a down payment created with the contract, have none).
  - The lines keep their own rows and the same rules as before: each line may not exceed what is still owed on
    its installment (or on `agreed_down_payment − paid`), amounts are never edited, nothing is deleted.
    "Auto-split" is therefore only a *client convenience*: the screen computes the split and sends it explicitly,
    the API validates each line on its own.
  - Only an **active** contract can be collected against (drafts have no installments; a cancelled contract's
    schedule is closed) — enforced in `InstallmentService::recordPayment` for every payment, not just receipts.
  - Cancelling a receipt cancels **every** line it created (installments go back to due/partial from their
    remaining valid payments; the down payment row is cancelled) and keeps everything on file with a reason.
    The receipt itself keeps its number and total, marked `cancelled`.
  - Payment methods grew to match the screen: `cash | bank_transfer | cheque | vodafone_cash | instapay | other`
    (`App\Enums\PaymentMethod`), used by reservation, down-payment and installment payments alike.
  - **Not covered yet:** a lease's `security_deposit` is stored but is not collectable through a receipt — it is
    not part of `agreed_down_payment`, so `remaining_down_payment` stays 0 for leases. Needs a decision: is the
    deposit part of the contract value, or a separate refundable amount with its own payments?

- **Collection page & bell (2026-10-29, unconfirmed):** «الأقساط والإيجارات المستحقة» is a read-only view over the
  active contracts, backed by `GET /admin/installments` and `GET /admin/down-payments` (plus their `/calendar`).
  - The four display states are computed against **today**, not read from `installments.status` (which only changes
    when a payment is recorded): nothing left = `paid`; unpaid and past due = `overdue`; some paid and still due =
    `partially_paid`; nothing paid and not past due = `due`. Overdue wins over partial, so the chips partition rows.
  - A down payment is **one row per active contract** with `agreed_down_payment > 0`, due on `contract_date`,
    paid = reservation deposit + valid down-payment receipts, remaining = agreed − paid. Reaching the contract date
    with money still owed makes it overdue (same rule as an installment). Because a rent contract's
    `security_deposit` is not part of `agreed_down_payment`, leases usually have no row here (see the open question above).
  - Totals on the cards are the scope totals (search/type/date range) before the status/day filters; the status chips
    are counted after the type filter and the type chips before it, so selecting a chip never changes its own counts.
  - The bell is **server-driven and narrow**: only unpaid installments/rents of active contracts, split into «متأخرة»
    and «تستحق اليوم». Lease expiry and maintenance were dropped from it (no API for maintenance yet; expiry not requested).
    Each group returns its full count but at most 10 rows; opening the bell still marks the loaded keys as seen locally.

- **Installments summary report (2026-10-29, unconfirmed):** «ملخص الأقساط والعقود» is one row per **non-draft**
  contract (active + cancelled; a draft has no schedule to summarise), from
  `GET /admin/reports/installments-summary`, read-only.
  - Filters: `type` (`sale|rent`), `building_id` (through the contract's unit), `client_id`, `status`
    (`active|cancelled`). The screen offers only «نشط / ملغي» — the prototype's مكتمل/منتهي/مجدد/مرتجع have no API state.
  - `meta.counts` (`all/sale/rent`) is counted **before** the `type` filter, so the type chips never rewrite themselves;
    the other filters (building/client/status) do narrow the counts.
  - Sale money: value = `total_price` (the agreed net price), paid = down payment paid + installments paid,
    remaining = `down_payment_remaining` + `installments_remaining`. Lease money: value = the whole schedule,
    paid = installments paid, remaining = `installments_remaining`; the `security_deposit` is a **separate upfront
    balance**, not part of the contract value (still not collectable — see the open question above).
  - A schedule row counts as collected when its `remaining <= 0`; a partially paid row is not «مسدد». `next_due_installment`
    is the first row by `sequence_number` with something still owed, `last_paid_installment` the last fully collected row —
    both printed as `{sequence_number, due_date}` only.
  - The rows are returned whole (no paging): the report is searched, sorted and exported client-side.
  - Permission: `reports.sales` (there is no dedicated report permission yet). Reading goes through
    `logReportAccess('installments_summary')` like the other report services, i.e. it is recorded in the audit log
    under the `export` action.

- **Due & overdue report (2026-10-29, unconfirmed):** «الأقساط المستحقة والمتأخرة» (aging) is one row per unpaid
  installment of an **active** contract that is due today or already past due (`remaining > 0`, `due_date <= today`).
  It reads `GET /admin/reports/due-overdue`, read-only.
  - Filters: `type` (`sale|rent`), `building_id` (through the contract's unit), `client_id`, `bucket`.
  - Buckets are **days late**: `0-30`, `31-60`, `61-90`, `90+`; a row due exactly today counts as `0-30` with
    `days_overdue = 0`. Partially paid rows stay in (with what is left), fully paid rows drop out.
  - `meta.buckets` (`count` + `total` per bucket, plus `all`) is counted over the whole scope, so picking a bucket
    narrows the table without rewriting the chip numbers.
  - `meta.due_within_7_days` is a separate figure, not an aging bucket: unpaid rows of the same scope falling due
    between tomorrow and seven days out (the «يستحق خلال 7 أيام» card). Rows due today are excluded from it.
  - Down payments are **not** part of this report (it is the installments/rents aging); their own page is the
    collection screen. Purchases/leases both appear, distinguished by `contract_type`.
  - The rows are returned whole (no paging): the report is searched, sorted and exported client-side.
  - Permission: `reports.sales`; reading is audit-logged as `due_overdue` (under the `export` audit action, like the
    other report services).

- **Customer statement (2026-10-29, unconfirmed):** «كشف حساب عميل» reads
  `GET /admin/reports/customer-statement?client_id&from_date&to_date` — one client's reservations, contracts (with
  their schedule) and every payment of the period, read-only.
  - Each payment line says whether it paid a reservation, a down payment or an installment, and now also carries
    `contract_id` / `contract_number`. A reservation payment has both as `null`: the contract only exists after the
    reservation is converted.
  - `totals.required` is the period's contract value, `totals.paid` = reservation deposits + collected contract money,
    `totals.remaining` = contract value − collected. `totals.overdue` is the **sum of the overdue installment
    remainders** (rows past their due date with something left), not the whole contract remainder — a contract with one
    late row reports only that row, and a fully future schedule reports 0.
  - Cancelled payments are listed with `is_cancelled` and their `cancel_reason`; they are excluded from `totals.paid`
    and their amount is reported separately as `totals.cancelled_payments` (nothing is deleted).
  - The screen asks for the client's whole history (`1900-01-01` … `2100-12-31`) and filters the period locally, so
    the running balance still carries forward; picking one contract rebuilds the balance for that contract alone.
  - Permission: `reports.customer_statement`; reading is audit-logged as `customer_statement`.

- **Building & unit statements (2026-10-29, unconfirmed):** «كشف عقار» reads
  `GET /admin/reports/building-statement?building_id&from_date&to_date` and «كشف وحدة» reads
  `GET /admin/reports/unit-statement?unit_id&from_date&to_date`; both are read-only (`reports.building` /
  `reports.unit`, audit-logged as `building_statement` / `unit_statement`).
  - **Only active contracts feed the money figures** (`sales`, `remaining`, `due`, `overdue`, `monthly_rent`).
    A cancelled contract stays in the `contracts` list as history (`is_active: false`) but contributes nothing, and
    neither do its cancelled schedule rows: a cancelled installment keeps its stored `remaining`, so every rollup
    filters `InstallmentStatus::CANCELLED`. Drafts are not part of a statement at all.
  - Money of one contract is shared (`BaseReportService::contractMoney()`): **sale** value = `total_price`,
    paid = down payment (reservation deposit included) + collected schedule, remaining = down-payment balance +
    schedule balance; **lease** value = the whole schedule, paid/remaining from the schedule only (the security
    deposit is separate). `overdue` = unpaid rows past their due date, `due` = unpaid rows due up to the end of the
    current month.
  - Building `totals.collected` is the **period's** valid payments (not the sum of each contract's lifetime paid);
    `totals.cancelled` is the period's cancelled payment lines (reported, never added to `collected`). Each floor
    shows the same six figures, with `collected` mapped through the unit's floor; a building-level reservation
    payment has no unit and lands on the building alone.
  - `counts.closed` = units that are `available` but flagged `is_sellable = false` («غير قابلة للبيع»); a unit that
    is sold/rented/reserved is counted under that status even when the flag is set.
  - Unit statement: whole history of the unit's reservations and contracts, `current_contract` = the active contract,
    `current_reservation` = the active reservation, and the current contract's `installments[]` carry `is_cancelled`,
    `is_overdue` and `paid_at` (the latest valid, non-cancelled, non-deleted payment date). `totals.deposit_paid` is
    the still-open reservation's deposit only — a converted deposit is already inside the contract's paid down payment.
  - The screens have no date pickers (like the prototype), so the front-end asks for the whole history
    (`1900-01-01` … `2100-12-31`) and the server rolls it up.
  - The shared `paymentsQuery` / `cancelledPaymentsQuery` apply their filters **inside every union branch**
    (`withPaymentFilters()` + `PAYMENT_FILTER_COLUMNS`) — a `where` after `unionAll()` only narrows the first select —
    and `paymentsQuery` returns `status = valid`, non-deleted rows only.

- **Monthly revenue & daily collection (2026-10-29, unconfirmed):** «الإيرادات الشهرية» reads
  `GET /admin/reports/monthly-revenue?from_date&to_date&building_id` (`reports.sales`, audit-logged as
  `monthly_revenue`) and «التحصيل اليومي» reads `GET /admin/reports/daily-collection?from_date&to_date&building_id`
  (`reports.daily_inventory`, audit-logged as `daily_collection`). Both are read-only and read the same payment union
  as the statements, so they report **money actually collected**, not contract values.
  - Monthly: one row per month that has a valid payment or a cancellation — `payments` (lines), `receipts` (distinct
    receipt numbers), `reservations` / `down_payments` / `installments` (amounts by payment type), `total`,
    `cancelled` and `cumulative`. Money is keyed by `paid_at`'s month; a cancelled line is keyed by `cancelled_at`'s
    month so it lands where it was reversed, and it never enters `total`. `cumulative` restarts at the period.
    `totals` sums the same fields over the whole period.
  - A reservation deposit and a payment recorded straight on an installment (the per-installment endpoint) have no
    receipt, so `receipts` is lower than `payments`; their money is still counted, and the screens footnote it.
  - Daily: `summary` (`collected`, `cancelled`, `net`, `lines`, `receipts`, `days`), `by_type`, `by_method` (present
    methods only), `by_day` (days with money, oldest first), `payments[]` (valid lines, newest first) and
    `cancelled_payments[]` (with `cancel_reason`). Every line carries `payment_type`, `paid_at`, `amount`, `method`,
    `receipt_number`, `contract_id` / `contract_number` / `contract_type` / `sequence_number` (all `null` for a
    reservation payment) and `client_name` / `unit_name` / `building_name` — the extra names come from the shared
    `paymentsQuery`, which left-joins clients/receipts and, for the reservation branch, units/buildings.
  - Cancelled lines are matched with `whereDate('cancelled_at', …)`: the column is a timestamp, and a plain string
    bound dropped every cancellation made on the last day of the period.
  - The front-end has no date range of its own on «الإيرادات الشهرية» (it asks for the last 12 calendar months up to
    the real today) and defaults «التحصيل اليومي» to the last 30 days; both have a building filter.

- **Unit status report (2026-10-29, unconfirmed):** «حالة الوحدات» reads
  `GET /admin/reports/unit-status?building_id&floor_id&type&purpose` (`reports.unit`, audit-logged as `unit_status`).
  Every unit of the scope is listed with its building, floor, type, purpose, area, listed `sale_price`, state, the
  open contract / reservation it sits on, and its client.
  - `counts` = `total` + `available` / `reserved` / `sold` / `rented` / `closed`. `closed` are the units that are
    `available` but flagged `is_sellable = false` (the «غير قابلة للبيع» flag), the same rule as the statements, so
    they are counted once and never as «متاحة».
  - There is **no «مرتجعة» state** in the API: cancelling a contract frees the unit back to `available`, so the
    prototype's returned tab has no source. A unit with an open reservation shows it (`reservation_date`,
    `deposit_paid`) and has no contract yet.
  - Money follows the state: a **sold** unit carries its active contract's `total_price` (net price, like the
    statements), an available / reserved / sold unit carries its listed `sale_price` (contract price, or
    `sale_price`, or area × `price_per_meter`) and `null` for rent-only units, and a **rented** unit carries its
    active lease's `monthly_rent` plus `contract_end_date`. `totals.sale_value` / `sale_area` only count units that
    offer sale; `totals.monthly_rent` only the live leases.
  - `by_building[]` repeats the five counts plus area / sale value / monthly rent per building, so the breakdown
    table never re-aggregates on the client.

- **Cascade deletion of a building or a unit (2026-10-30, decided by the owner):** `DELETE /admin/buildings/{id}`
  and `DELETE /admin/units/{id}` are **permanent** (hard delete) and take everything that hangs on the target with
  them: the building's floors and units; every reservation on those units (or on the building itself, when it had no
  unit) with its deposit payments; and every contract on those units with its installments, down payments, receipts
  and payment lines. Clients are never deleted — they are master data and keep their other deals.
  - This replaces the earlier guards (BRIEF 2.1 blocked a building that had units; 2.3 blocked a unit with an active
    reservation or a live contract). Nothing blocks the delete any more; the confirmation in the UI is the only
    warning.
  - The response lists what was removed: `data.deleted = {units, floors, reservations, deposit_payments, contracts,
    installments, receipts, payments}` (the unit response has no `floors`).
  - One audit entry per call: action `delete`, entity `buildings`/`units`, the old building/unit values, and
    `meta.deleted` with the same counts. The audit log of the deleted deals stays (append-only).
  - Money disappears from every report/statement immediately because the payment rows no longer exist.
  - Deletion order (`App\Services\Units\UnitTreeDeleter`): receipts first (the `receipts.contract_id` FK is
    `restrictOnDelete`), then payment lines/down payments/installments, contracts, reservation payments,
    reservations, units/floors, the building.

## Cross-cutting

- Locale: `ar` by default, `en` secondary, from `Accept-Language`.
- Lists: Laravel's default page size is 15; only buildings currently accept `per_page` (capped at 100).
- Optimistic locking: `lock_version` required on updates; mismatch returns 409.
- Money: `DECIMAL(14,2)`, computed through `MoneyCalculator`; never float.
- Audit log kept forever (no retention policy yet).
- Reading financial reports / statements is NOT audited yet (only exports are).
- Post-login landing page: role/permission based (not built — there is no dashboard).
- Reports: single currency with a configurable symbol; customer statement uses an internal layout.

## Open questions (blocked on the owner)

- Refunds/forfeits when a reservation or contract is cancelled (payments are currently just recorded).
- Late fees, interest, annual rent increase, renewals — none implemented.
- Who may override a price away from the reservation price (permission exists: `override price`).
- Backup retention/off-site copies/alert channel (Phase 7, deferred until a server exists).
