# Sprint 2 report — End-to-end sale

Status: **finalized — approved by the owner (2026-11-10)** after a passing manual browser test. Committed on branch `sprint-2-end-to-end-sale`, ready to merge into `main`.

## What was built
**Backend**
- **Recipes:** `RecipeLine`; `GET/PUT /variants/{id}/recipe` (whole-recipe replace under a variant lock, `INVALID_RECIPE` 422 with per-line problems, replace-slot `warnings`, before/after audit).
- **Modifiers:** `ModifierOption`, `ModifierOptionPrice`, `ModifierEffect`; `GET/POST /modifier-groups`, `GET/PATCH /modifier-groups/{id}`, `POST /modifier-groups/{id}/options`, `PATCH /modifier-options/{id}` (prices/effects replaced wholesale when sent). Baristas see active groups/options with prices only (no effects, no slot). Products return linked groups with options. Admin group detail lists `slot_warnings`.
- **Shifts:** new `shifts` app; `POST /shifts/open`, `GET /shifts/current` (live cash/card sales, order count, expected cash). One open shift per user, enforced by a partial unique index (two racing opens → one 201, rest 409).
- **Engines (pure, no DB):** `sales/pricing.py`, `sales/consumption.py` (+ `domain.py`, `loader.py` that builds their input).
- **Quote:** `POST /orders/quote` (no writes, no shift needed).
- **Checkout:** `POST /orders/checkout`, idempotent, one transaction; lock order shift → invoice counter → stock balances (by ingredient id); gapless `POS-0000001` numbers; cash/card/mixed; four snapshots per item; `sale` ledger movements with `balance_after`; audit `order.created`; shortages never block (warnings only).
- **Orders:** `GET /orders` (Admin: all + date/status/cashier/shift filters; Barista: today in the café's time zone, or an exact invoice number for any date), `GET /orders/{id}`, `GET /orders/{id}/receipt` (built only from the order's snapshots).
- **Settings:** paper widths 58/76/80/112 mm + A4; tax default is now "added on top" (still off until an Admin enables it and types the rate).
- **`seed_demo`:** Iced Latte recipes for 3 sizes, Milk Type (Oat Milk), Extras (Extra Shot, Syrup), opening stock. Idempotent.

**Frontend**
- Recipe editor per size (live per-unit preview, server warnings), modifier groups linked on the product page, `/admin/modifiers` (groups, options, per-size prices, effects with "All sizes" row).
- `/pos`: shift gate, search + category tabs, product sheet (sizes, modifiers with min/max, quantity), cart saved in sessionStorage, debounced server quote, tax line, stock-warning banner, payment dialog (cash with quick amounts and change / card / mixed), safe retry with the same key, price-changed reconfirmation, success screen, phone bottom-sheet cart.
- `/orders/:id/receipt` print view (per-device paper width, `@page` size, REPRINT), `/orders` list, `/orders/:id` detail with Reprint. Baristas land on `/pos`.
- Settings: width list + Save button at the bottom.

## Test and check results (local, Docker)
| Check | Result |
|---|---|
| `ruff check` / `ruff format --check` | pass |
| `makemigrations --check --dry-run` | no changes |
| `pytest` | **388 tests pass** (after both audits' fixes), coverage 99% |
| `spectacular --validate --fail-on-warn` | clean |
| `tsc --noEmit`, `eslint src`, `vite build` | pass |
| Live API smoke on the dev stack (seed_demo → shift → quote → checkout → replay → orders → shift totals) | pass: Large + Oat deducts no regular milk; replay returned `Idempotent-Replayed: true` |
| **Browser run of the UI** | **PASS (owner, 2026-11-10).** The assistant could not run a browser (Chrome extension not connected); the owner ran the manual test checklist below and reported that everything works. |

Acceptance tests covered: AT-02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 26, plus min/max, missing slot, option without effect for a size, payment errors leaving nothing behind, checkout without a shift, gapless invoices across a failed checkout, permission matrix and tenant isolation for every new route/model.

## Deviations from the spec / plan
1. **Commits:** none during the sprint (owner rule), instead of spec 0.1 "commit after each task"; the work was committed in groups after the build and audit, on branch `sprint-2-end-to-end-sale`.
2. **Barista order detail/receipt** opens any order of the café by its id; the *list* stays today + exact invoice lookup. **Approved by the owner (2026-11-10)**; spec section 6 updated.
3. **Duplicate option ids** in one cart line return `MODIFIER_SELECTION_INVALID` with `reason: duplicate_option` (the spec names no code for it).
4. **Shift close, refunds, drawer expenses, promotions** are not in Sprint 2 (Sprint 3 / P1). The shift model already has all close fields.
5. **Concurrency test (AT-12):** 5 real threads, each its own cashier, leave exact balances and gapless invoices. Because every checkout locks the invoice counter first (needed for gapless numbers), all checkouts of a café are serialized, so this test cannot prove the stock-balance lock *by itself*. `test_at12_balance_row_lock_holds_against_a_concurrent_adjustment` closes that gap: a checkout thread and a stock-adjustment thread (which does not take the counter lock) hit the same ingredient 15 times each; the balance and every `balance_after` must be exact. Removing only the checkout balance lock fails it (lost updates: 92 instead of 100).
6. Tax default changed to "on top" and paper widths widened (owner answers, 2026-11-10); spec updated.
7. `GET /orders` ignores `from`/`to` for Baristas.
8. New error code `REGISTER_NOT_CONFIGURED` (422): opening a shift when the café has no default register, or more than one (a second branch). v1 is single-branch and users carry no branch, so the server refuses instead of guessing.

## Audit (2026-11-10) and fixes
A read-only review of Sprint 2 found 2 High, 4 Medium and 5 Low issues. All are fixed.

| # | Finding | Fix | Test |
|---|---|---|---|
| H1 | On a shared tablet the next cashier saw the previous cashier's cart and unconfirmed sale; a Retry could replay the other user's order, or create it under the wrong shift. The server matched idempotency keys by organization only. | Server: a key belongs to the user who first sent it; another user gets 409 `IDEMPOTENCY_CONFLICT`. POS storage keys are per user. | `test_same_key_from_another_user_is_a_conflict_not_a_replay`; live check: A 201, B 409, A replay 201 |
| H2 | A 502/503/504 from a proxy counted as a final answer: the pending sale was dropped and the cashier could charge again (double sale). | 5xx and timeouts count as "uncertain" and are resent with the same key (`pos/checkoutRules.ts`). | Frontend has no test runner until Sprint 4 (Playwright, AT-20); logic isolated in a pure function |
| M1 | A new sale could start while one was unconfirmed, overwriting its key. | Pay, cart edits and new items are blocked until the pending sale is resolved; `start()` refuses a second key. | as H2 |
| M2 | Admin orders filter with only "From" ended on the UTC date. | Ends on the café's local today. | `test_admin_from_only_ends_on_the_cafes_local_today` |
| M3 | After "price changed", payment could be confirmed with the old total. | Payment opens and confirms only on a fresh quote. | as H2 |
| M4 | A 0.00 item could never be sold. | Owner decision: a 0.00 order takes no payment (spec 8.4). | `test_zero_total_order_needs_no_payment`, `..._rejects_a_payment` |
| L1 | `tenancy` imported `sales` (seed created the invoice counter). | Removed; the counter is created at the first checkout. | `test_orgs_have_independent_invoice_counters` |
| L2 | Generic audited create/update lived in `catalog.services` and was borrowed by `modifiers`. | Moved to `core/audited.py`. | existing catalog/modifier tests |
| L3 | `shifts` imported `sales` models inside a function. | `sales.selectors.payment_totals(shift)` is the one entry point. | existing shift-total test |
| L4 | `Pos.tsx` mixed the checkout state machine with the screen. | `pos/useCheckout.ts` hook. | tsc/lint/build |
| L5 | Recipe editor compared waste % with a JS float. | Scaled-integer compare. | tsc/lint/build |

**Second audit (2026-11-10), owner-requested fixes:**

| # | Finding | Fix | Test |
|---|---|---|---|
| M5 | `docker-compose.yml` default `DB_PORT` had moved to 5432, which collides with a host Postgres. | Back to `${DB_PORT:-5433}`; README updated. | `docker compose up -d --wait db` |
| M6 | The API client stopped the timeout before reading the body and turned an unreadable body into `null`, so a cut-off 201 looked like a success with no result. | Timeout covers the body; an unreadable non-204 body is a `NetworkError`, so checkout resends the same key. | tsc/lint/build |
| M7 | AT-12 could not prove the stock-balance row lock. | New 2-thread checkout vs stock-adjustment test (see deviation 5). | `test_at12_balance_row_lock_holds_against_a_concurrent_adjustment` |
| L6 | Opening a shift raised a 500 with no default register or with several. | 422 `REGISTER_NOT_CONFIGURED` (deviation 8). | `test_open_without_exactly_one_default_register_is_422_not_500` |

## Known issues / limits
- Recipe line display order relies on creation timestamps (no explicit position column).
- A Barista list shows today's orders by the café's time zone; a sale made just before local midnight moves to "older" after midnight (invoice search still finds it).
- Pickers load all ingredients/products (100 per request, looped), as in Sprint 1.
- `npm audit` advisories unreviewed. Arabic strings are still empty (D12); new keys were added to `ar.json` with empty values.

## Owner manual test checklist — passed (owner, 2026-11-10)
Start: `docker compose up -d --build --wait`, then `docker compose exec backend python manage.py seed_demo` (needed once; the backend container applies migrations itself). App: http://localhost:5173. Logins `admin`, `barista1`, `barista2`, password `Demo-pass-123`.
- [x] As admin: open Products → Iced Latte → **Recipe** on each size; check the preview (12 g + 5% = 12.600). Change a recipe and save.
- [x] As admin: Modifiers → check **Milk Type** (replace, slot `milk`, Oat Milk with a Large price of 20 and per-size effects) and **Extras** (Extra Shot). Link both on the product page.
- [x] Remove the `milk` slot from one size's recipe: the Recipe editor and the group show a warning; restore it.
- [x] As barista1: the POS asks for a shift. Open it with 300.00.
- [x] Sell **Large + Oat + Extra Shot**: price 120.00. In Admin → Inventory → Movements: Oat Milk and Coffee deducted, **no Whole Milk**.
- [x] Sell more than the stock of something: a warning appears, the sale still goes through, the balance goes negative.
- [x] Pay **cash with change**, **card only**, and **mixed** (e.g. cash 80 + card 120 on 200).
- [x] Turn tax on in Settings (type a rate): the cart, payment and receipt show a tax line added on top. Turn it off again.
- [x] Success screen → **Print receipt** on your real printer at 58 or 80 mm (pick the width on the receipt page; the device remembers it). Reprint from Orders (shows REPRINT).
- [x] As barista: Orders shows today's orders; search an older invoice number.
- [x] Use the POS on a phone (bottom-sheet cart) and switch EN/عربي to check the layout mirrors.
- [x] Go offline (browser devtools) during a payment: "Checking payment status…", then Retry after going online gives **one** order, not two.

## Handoff to Sprint 3
- Sprint 3 still needs your answer on **returns (D8/D9)**.
- Shift close must take the same shift row lock as checkout (`CashierShift` `select_for_update`) so a close can never interleave with a sale.
- `Order.status`, `refund: null` on order detail/receipt and the REFUNDED banner are already in place for refunds.
