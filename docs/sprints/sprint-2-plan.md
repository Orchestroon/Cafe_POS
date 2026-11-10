# Sprint 2 plan — End-to-end sale

Read: CLAUDE.md, PROGRESS.md, sprint-1-report (handoff), spec §5, §6, §7.3–7.7, §8.1–8.5, §8.10–8.11, §9, §10.2–10.4, §10.6, §11 (Sprint 2), §12, §14.

Status: **implemented, awaiting owner testing (2026-11-10).**

## Owner answers (2026-11-10)
| # | Topic | Answer | Effect on the plan |
|---|---|---|---|
| Q1 | Printer (D13) | Confirmed: browser print to receipt (thermal) printers. Fixed list of market paper widths. Width chosen **per device** (option A): each device remembers the width of the printer it uses; Settings holds the default. No auto-detection (browsers cannot read the printer's paper), no print agent. | Task S1 + receipt view (task 15) |
| Q2 | Tax (D11) | Tax stays **off** until the Admin turns it on in Settings and **types the rate manually**. When turned on, tax is **added on top** of menu prices. | Task S2 |
| Q3 | Shifts (D7) | Confirmed: per user, own cash, own open shift for checkout. | No change |
| Q4 | Returns (D8/D9) | Not answered yet; needed before Sprint 3 only. | No change in Sprint 2 |
| Q5 | Commits | **No commits until the owner has tested locally.** This includes the uncommitted docker-compose change. | See "Way of working" |

## Spec and settings changes from the owner answers (first task)
- **S1 Paper widths:** `OrganizationSettings.receipt_paper_width` choices become **58mm, 76mm, 80mm, 112mm, a4** (migration; the existing `80mm` stays valid; default stays `80mm`). The Settings page and the receipt view's per-device picker show the same list. Update spec D13, §7.1, §10.3.
- **S2 Tax on top:** model default `prices_include_tax = False`; a data migration sets the existing organization to `False` **only while tax is still disabled** (an Admin choice is never overwritten). `tax_enabled` stays `False`; `tax_rate` stays `0.00` (Admin types it, 0–100, already validated). Update spec D11 and the §14 table.
- **S3 Decisions recorded:** Q1–Q3 and Q5 into PROGRESS.md; D7 and D13 marked confirmed.

## Assumptions / decisions (also go to the report's Deviations)
1. **Shift close stays in Sprint 3.** Sprint 2 builds open and current only. The `CashierShift` model is created with all close fields now (nullable), so Sprint 3 needs no model rework. `GET /shifts/current` returns `cash_sales`, `card_sales`, `orders_count`, `expected_cash`; refunds and drawer expenses show `0.00` until Sprint 3.
2. **Not in Sprint 2:** refunds (Refund button hidden on the order detail), drawer expenses ("Pay from drawer"), promotions (P1). The pricing engine keeps the promotion hook: `unit_discount = 0.00`, `promotion_snapshot = null`.
3. **Checkout lock order:** shift row → `InvoiceCounter` → `StockBalance` rows ordered by `ingredient_id`. Every checkout locks in the same order, so concurrent checkouts cannot deadlock. Locking the shift row means the Sprint 3 shift close (same lock) can never close a shift halfway through a sale.
4. **Barista "today"** = the organization-local calendar day (`timeutils.local_date_range`, Africa/Cairo, DST-safe). Exact `invoice_no` lookup works for any date. An order a Barista cannot see returns **404** (not 403), so invoice existence does not leak.
5. **REPRINT marker:** shown when the receipt is opened from order history (`?reprint=1`); not on the first print right after checkout. No server-side print counter.
6. **Option per-size prices and effects** may reference any active variant in the organization; the engines read only rows for the variant being sold. On `PATCH /modifier-options/{id}`, `variant_prices` and `effects` are each replaced wholesale when present and left alone when absent.
7. **No delete** for modifier groups or options: deactivate only (§5.4, history reads snapshots).
8. **An empty recipe is allowed** (`lines: []`): the item sells with no stock deduction (e.g. a service item). Packaged goods use a one-line recipe (D18).
9. **Barista sees no effects/recipes:** `GET /modifier-groups` for a Barista returns active groups and options with prices only (what the POS needs); effects and recipes are Admin-only.
10. **Recipe editor preview** ("consumption per unit") is computed in the browser with a scaled-integer decimal helper (no floats, §5.1). The server value is the source of truth.
11. **Quote** needs a logged-in user but no shift (§8.3). Quote and checkout call the same engines and the same data loader.
12. **AT-26 (tax inclusive and on top)** is tested in Sprint 2 (§12 lists it for Sprint 2).
13. **`seed_demo`** is extended: Iced Latte recipes per size (coffee slot + milk slot), Milk Type replace group with Oat Milk (per-size price and effects), Extras add group with Extra Shot, so the owner checklist works right after seeding.
14. **Arabic:** new UI strings get keys in `en.json` and empty values in `ar.json`, as in Sprint 1 (D12).
15. **Menu prices on the POS are shown before tax**; tax appears as its own line in the cart totals, the payment dialog and the receipt (follows Q2).

## Backend

- [x] **1 Recipes** (`catalog`)
  - `RecipeLine` model: `variant`, `ingredient`, `base_qty`, `waste_pct`, `slot_key`. DB constraints: unique(variant, ingredient); unique(variant, slot_key) where not null; `base_qty ≥ 0`; `0 ≤ waste_pct ≤ 100`.
  - `GET /variants/{id}/recipe` → `{variant_id, lines, warnings, updated_at}`.
  - `PUT /variants/{id}/recipe`: in one transaction, lock the variant, validate (ingredients exist in the org and are active, `base_qty ≥ 0`, waste 0–100, no duplicate ingredient or slot, slot is a slug) → 422 `INVALID_RECIPE` with per-line details; replace all lines; audit `recipe.replaced` with before/after lines.
  - `warnings`: every `replace` group linked to the product whose `replacement_slot` is missing from the new recipe (PUT still succeeds, §8.10).
- [x] **2 Modifiers** (`modifiers`)
  - Models `ModifierOption` (label, `price_delta ≥ 0`, sort, active; unique(group, label)), `ModifierOptionPrice` (unique(option, variant)), `ModifierEffect` (variant nullable; unique(option, variant, ingredient) plus unique(option, ingredient) where variant is null).
  - `GET/POST /modifier-groups`, `GET/PATCH /modifier-groups/{id}`: validates mode/slot (slot required iff `replace`), `min ≤ max`, `max ≥ 1`. Admin detail includes `slot_warnings` (linked variants missing the slot).
  - `POST /modifier-groups/{id}/options`, `PATCH /modifier-options/{id}` with `variant_prices` and `effects` (§9.4 shape), validated (same org, active ingredient, no duplicates).
  - Products GET returns linked groups with their active options and per-size prices (for the POS).
  - Audit for every group, option, price and effect change, with before/after.
- [x] **3 Shifts** (new `shifts` app)
  - `CashierShift` with every §7.6 field; DB partial unique (user) where `status = open`; `opening_cash ≥ 0`.
  - `POST /shifts/open {opening_cash}`: default branch and register; a second open → 409 `SHIFT_ALREADY_OPEN` (also when two opens race: the DB constraint catches it); audit `shift.opened`.
  - `GET /shifts/current` → own open shift with live totals, or `data: null`.
- [x] **4 Pricing engine** (`sales/pricing.py`, pure, no DB)
  - Item validation: quantity 1–99 (`INVALID_QUANTITY`), variant/product/category active (`ITEM_UNAVAILABLE`).
  - Modifier validation: option and group active and linked (`INVALID_MODIFIER`), duplicate option IDs, min/max per linked group including zero selections (`MODIFIER_SELECTION_INVALID`).
  - Prices: per-size override else `price_delta`; line and order totals; tax for disabled / inclusive / on top (§8.1 table); all rounding through `core/money.py`.
  - Unit tests for every rule and rounding edge.
- [x] **5 Consumption engine** (`sales/consumption.py`, pure, no DB)
  - Working lines keyed by slot or `ing:<id>`; `replace` removes the slot once (`INVALID_MODIFIER` `slot_missing` if absent); effect resolution (size-specific, else "all sizes", else invalid; zero effects = no impact / "No milk"); waste applied exactly once; multiply by qty; aggregate per ingredient; stock warnings (never blocking).
  - Unit tests incl. AT-02, AT-03, AT-04, AT-05.
- [x] **6 Sales models + quote**
  - `InvoiceCounter`, `Order`, `OrderItem`, `Payment` with every §7.7 constraint (unique invoice no/seq/idempotency key per org; `amount > 0`; unique(order, method); quantity 1–99).
  - One data loader that fetches everything the engines need in a fixed number of queries.
  - `POST /orders/quote` → §9.4 response (totals, items, consumption, `stock_warnings`). No writes, no locks, no shift.
- [x] **7 Checkout** (`POST /orders/checkout`, `sales/services.py`)
  - Inside `run_idempotent` (scope `checkout`) and one `transaction.atomic()`: own open shift (locked) else 409 `SHIFT_NOT_OPEN`; non-empty cart (`EMPTY_CART`); engines on fresh data; `expected_total` ≠ server total → 409 `PRICE_CHANGED` with `{server_total, quote}`; payments (1–2, one per method, > 0, sum = total → `PAYMENT_MISMATCH`, cash tendered ≥ amount, change computed, card reference optional); lock + increment counter, `invoice_no = prefix + 7 digits`; create order, items with all 4 snapshots, payments; lock balances by ingredient id, apply deltas, write `sale` movements (one per item × ingredient) with `balance_after`; audit `order.created`; 201 with payments, `change_due`, `receipt_url`, `stock_warnings`.
  - Any failure rolls back everything (order, payments, movements, counter, idempotency record).
- [x] **8 Orders and receipt**
  - `GET /orders` (filters `from`, `to`, `status`, `cashier_id`, `shift_id`, `invoice_no`) with Barista rules in `sales/selectors.py` (assumption 4).
  - `GET /orders/{id}`: items, snapshots, payments, refund (null for now).
  - `GET /orders/{id}/receipt`: §9.4 receipt shape, built only from the order's snapshots and the stored tax snapshot (a later price/recipe/settings change never changes an old receipt, except header/footer and paper width from current settings).
- [x] **9 Permissions and tenancy**
  - New named permissions in `core/policy.py` (`recipes.manage`, `modifiers.manage`, `shifts.own`, `sales.quote`, `sales.checkout`, `orders.view`, …).
  - Every new route in the permission matrix test (anonymous 401, Barista on admin routes 403 with no side effects); every new model in the two-organization isolation test.
- [x] **10 `seed_demo`** extension (assumption 13).
- [x] **11 Tests** (beyond the unit tests in 4 and 5)
  - AT-02 … AT-13 and AT-26 end to end through the API.
  - Min/max violation, missing slot, option with no effect for the size.
  - Payment errors leave no order, no payments, no movements and no counter change.
  - Checkout without a shift → 409.
  - Invoice numbers stay gapless across a failed checkout.
  - AT-11: same key twice → one order, one set of movements, replay header; same key + different body → 409.
  - AT-12: concurrent checkouts on threads (`transaction=True`) → exact final balance; verified to fail with the lock removed.
  - AT-13: recipe edited after a sale → old snapshot and receipt unchanged.

## Frontend

- [x] **12 Shared pieces**
  - API client: `Idempotency-Key` header support; `crypto.randomUUID()` with a `getRandomValues` fallback (plain-HTTP LAN addresses have no `randomUUID`).
  - Decimal helper for money/qty strings (scaled integers, no floats): add, subtract, compare, round half up. Used for change, mixed-payment remainder and quick-amount buttons.
  - Types for recipes, modifiers, shifts, orders, receipts. Nav links: POS, Orders (both roles), Modifiers (admin). Barista lands on `/pos`.
- [x] **13 Admin screens**
  - Products page: per-size **Recipe** button → recipe editor (ingredient picker, base qty, waste %, slot key, live per-unit preview, server warnings shown after save); **Linked modifier groups** picker with order.
  - `/admin/modifiers`: groups list + create/edit (mode, slot, min/max, active), missing-slot warnings; options list; option editor with default price, **per-size price table** and **effects editor** ("All sizes" row + per-size rows).
- [x] **14 POS screen `/pos`** (§10.2)
  - Shift gate: no open shift → "Open shift" dialog (opening cash); selling disabled until open. Shift badge in the top bar.
  - Search + category tabs + product grid.
  - Product sheet: sizes with prices, modifier groups (radio when max = 1, checkboxes otherwise, min/max enforced), quantity stepper, add / edit line.
  - Cart: client-side with sessionStorage backup; change qty, remove, edit; every change calls quote (debounced ~300 ms); shows **server totals only** (subtotal, tax line, total); non-blocking stock-warning banner.
  - Layout: product area at the start and the cart at the end on tablet/desktop (mirrors in RTL); on phone, full-screen products and the cart as a bottom sheet with a sticky total and checkout button.
  - Payment dialog: Cash (exact / next 50 / next 100 / 200 quick buttons, tendered, change), Card ("Charge the card on the terminal first", optional reference), Mixed (cash amount, card = remainder). Confirm disabled until valid.
  - Reliability: key created on confirm and stored with the payload in sessionStorage until a definitive answer; network failure/timeout → "Checking payment status…" and up to 3 retries with backoff using the **same key**; then "Could not confirm — check connection, then tap Retry" (same key again). After a reload, an unresolved sale is offered for retry with the same key. `PRICE_CHANGED` → show old vs new total and require reconfirmation with a new key.
  - Success screen: invoice number, total, change due; **Print receipt** and **New order**. The cart clears only after success.
- [x] **15 Receipt view `/orders/:id/receipt`** (§10.3)
  - Rendered from the receipt endpoint; `@media print` hides the app chrome; `@page` size per paper width.
  - Paper width = this device's choice (localStorage, in try/catch) else the Settings default; a width picker on the receipt screen sets it for this device (same list as Settings). `@page` size is set from it so the print dialog picks matching paper.
  - Business header, invoice no, local date/time, cashier, items with indented modifiers, subtotal, discount, tax line (label, rate, amount) when enabled, total, payments, change, footer; REFUNDED banner support (used in Sprint 3); REPRINT on reprints.
- [x] **16 Orders `/orders`** (§10.4)
  - Admin: date-range filters (local dates), status, cashier. Barista: today's orders + exact invoice search.
  - Detail: items, modifiers, payments, status; **Reprint** (Refund comes in Sprint 3).
- [x] **17 Polish:** Save button also at the bottom of the Settings page (owner's Sprint 1 review); Settings paper-width list from S1.

## Close
- [x] **18** Full §4.4 check suite (ruff, migrations check, pytest, schema, tsc, eslint, build); browser run of the owner checklist on phone/tablet/desktop widths and in RTL; print preview at every paper width; update PROGRESS.md; write `sprint-2-report.md` with the owner checklist; **STOP** for owner testing.

## Way of working
- Order: S1–S3 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18.
- Tests run after each task; task ticked here.
- **No commits during the sprint (owner, Q5).** Work stays uncommitted until the owner has tested locally. Then commits are made in coherent Conventional Commit groups (docker change first, then settings/spec, backend, frontend, docs), with no `Co-Authored-By` or other attribution lines (CLAUDE.md). This differs from spec §0.1 ("commit after each task"): recorded as a deviation.
- Anything ambiguous on the way: ask before coding it; if I must proceed, take the safest option and record it as a deviation.
