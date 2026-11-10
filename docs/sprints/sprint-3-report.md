# Sprint 3 — Daily operations: report

Branch `sprint-3-operations-reports` (from `main` after the Sprint 2 merge). Not pushed, not merged: waiting for the owner.

## Delivered
**Backend**
- **Shifts:** `POST /shifts/{id}/close` (owner or Admin), `GET /shifts` (Admin; `user_id`, `status`, `from`, `to`), `GET /shifts/{id}`. The close locks the shift row first, then reads totals, so no sale, refund or drawer expense can commit in between. It stores `expected_cash`, `actual_cash`, `difference`, `close_note`, `totals_snapshot`, `closed_by`, `closed_at` and writes `shift.closed`. A closed shift shows its frozen snapshot.
- **Refunds:** `Refund` (1:1 with the order) and `RefundLine` in `sales`. `POST /orders/{id}/refunds`, idempotent (scope `refund:<id>`, key bound to the user). One line per original payment (D9). A cash line needs the refunding user's open shift (409 `SHIFT_NOT_OPEN`); the refund attaches to *that* user's shift. `confirm_amount != total` gives 422 `PARTIAL_REFUND_NOT_SUPPORTED`; a second refund gives 409 `REFUND_ALREADY_APPLIED`. No stock is restored (`inventory_restored: false`). Audit `refund.created`. Order detail and receipt now return the real `refund`. Admin ledgers `GET /refunds` and `GET /payments`.
- **Purchasing:** `Supplier`, `Purchase`, `PurchaseItem`. Suppliers list/create/patch; purchases list/create/get/patch/delete (draft only). The server computes `qty = pack_count × pack_size`, `line_total` and `total`. `POST /purchases/{id}/post` is idempotent (scope `purchase_post:<id>`), writes the `purchase` movements and exactly one `Expense`; a `cash_drawer` purchase needs the poster's own open shift, an Admin included.
- **Expenses:** `GET`/`POST /expenses` (a Barista sees and creates only their own, forced to cash from their own open shift), `POST /expenses/{id}/void` (Admin; a purchase expense, an already voided one, or a drawer expense of a closed shift gives 422 `EXPENSE_NOT_VOIDABLE`).
- **Reports (Admin):** sales-summary, payment-breakdown, top-products, stock, purchases-expenses, shifts, with `from`/`to` local dates (Cairo boundaries), `meta.range`, and `cashier_id` / `shift_id` filters.
- Policy: `shifts.manage`, `refund.create`, `ledgers.view`, `purchasing.manage`, `expenses.create/view/view_all/void`, `reports.view`.

**Frontend** (legacy theme, logical CSS only; `en.json` and `ar.json` both updated, `ar.json` values empty per D12)
- `/shift` (live summary, Pay from drawer, close flow) and `/shift/:id` (print-friendly report; an Admin can close another user's open shift); `/admin/shifts`.
- Refund dialog on the order page (allocation preview, reason, optional card reference, terminal and stock warnings, same-key retry) and a refund card on refunded orders.
- `/expenses` (Barista: own; Admin: all, new, void), `/admin/suppliers`, `/admin/purchases` and the editor with the pack helper and an irreversible-post confirmation.
- `/admin/reports/:name` (six pages with a date range) and the Dashboard (today's net sales, refunds, cash and card net, open shifts, low and negative stock).
- The Settings page already had a Save button at the bottom (carried-over note was already satisfied).

**Not built, by owner decision:** `GET /audit-events` and the Audit Log Viewer (Sprint 4).

## Checks (run in Docker, DB port 5433)
- Backend: **571 passed** (`docker compose run --rm backend pytest --no-cov -v`; incl. the new refund, shift, expense, purchasing and report suites, the permission matrix extended to every new route, and real-thread races), `ruff check`, `ruff format --check`, `makemigrations --check`, `spectacular --validate --fail-on-warn` clean. Coverage 99%.
- Frontend: `npm run typecheck`, `npm run lint`, `npm run build` pass.

## Tests mapped to the spec
AT-14, AT-15, mixed allocation, cash refund without shift (409), partial rejected, AT-16, AT-17, AT-18, close twice, Barista expense forced onto own shift, voided-expense exclusion (open shift) and closed-shift immutability, AT-22 reconciliation scenario (5 sales, cash and mixed refunds, a purchase, 3 expenses), Cairo boundaries (23:59:59 vs 00:00:00), permission matrix, cross-tenant 404/empty for every new route. Races: refund vs refund (different keys → one 201, one 409), purchase post vs post, shift close vs 6 checkouts (every committed sale is inside the frozen totals).

## Deviations / decisions to confirm
1. **No migration for the `purchase` stock-movement choices:** `purchase` / `purchase_item` already existed in Sprint 1's choices.
2. **Owner decision recorded in the spec:** a drawer expense of a **closed** shift cannot be voided (`EXPENSE_NOT_VOIDABLE`), nor can an already voided one.
3. A Barista asking for another user's shift (detail or close) gets **404**, not 403 (same as a missing one).
4. `POST /purchases/{id}/post` returns **200** (it changes a resource), refunds return 201.
5. Report date basis: orders, payments and items use the order's `created_at`; refunds and lines the refund's; so the §8.13 invariants hold at midnight. `cashier_id` on refunds means the *refunding* user. Documented in spec §8.13.
6. A card-only refund by a user with an open shift attaches that shift (spec 8.6.6); the shift's `card_refunds` is informational and does not change expected cash.
7. Shift list payloads recompute live totals per *open* shift (N+1 for open shifts only, page size ≤ 100); fine for a single café.
8. Purchase expense `paid_at` is the post time (not `purchased_on`); the purchases-expenses report dates by `paid_at`.
9. A purchase with total 0.00 cannot be posted (the expense amount must be > 0).

## Self-audit (read-only pass) — findings fixed
- **Fixed:** a `PATCH /purchases/{id}` with `items` missing `ingredient_id` or `unit_cost` could reach the service (DRF applies `partial` to nested fields) and raise a 500. Now 400, test added (`test_patch_items_missing_fields_is_400_not_500`).
- Lock order checked: checkout `shift → counter → balances`; refund `shift → order`; close `shift`; drawer expense `shift`; void `shift → expense`; purchase post `shift → purchase → balances (id order)`. No cycles.
- Tenant isolation: every queryset is filtered by organization; other-café ids return 404 or empty lists (tested per route).
- Error handling: bad UUIDs, dates, enums and report params give 400; no 500 found in the new routes.

## Independent audit (read-only) — findings fixed
- **M1** `parse_local_date` accepts only years 2000–2100; `0001-01-01` / `9999-12-31` were a 500 (`OverflowError`), now 400 on every report/ledger/list that takes `from`/`to` (tests over 6 routes).
- **M2** Dashboard "Open shifts" reads `GET /shifts?status=open&page_size=1` (counts shifts forgotten from earlier days).
- **M3** `POST /purchases/{id}/post` keeps the purchase body and adds `stock_movement_ids` and `expense_id` (spec 9.4).
- **M4** `POST /expenses` takes an optional `paid_at` for an Admin (not in the future); a Barista's is ignored; an Admin's *drawer* expense with `paid_at` is a 400 (it belongs to the open shift, back-dating would split it from the reports).
- **L2** The same refund key on another order is now 409 `IDEMPOTENCY_CONFLICT` (was a generic 400).
- **L3** The purchase editor shows a non-blocking hint when packs × pack cost differs from the stored line total because the unit cost is rounded to 4 decimals (`purchases.roundingHint`, empty in `ar.json`).
- **L5** Purchase post creates a missing `StockBalance` row like checkout does (never a `KeyError` 500).
- **L6** Real-thread races added: close vs cash refunds, close vs drawer expenses, close vs expense voids (each asserts the frozen snapshot equals what committed).

## Audit items left as documented deviations (owner to confirm)
- **L1** Field names differ from the §9.4 examples: the refund response has `status` (spec: `order_status`) and the shift close response nests the figures under `totals` (spec: flat).
- **L4** `purchases-expenses` ignores `cashier_id`/`shift_id` (expenses have no cashier filter in §8.13), and `top-products` returns at most 100 rows.
- The five deviations above (no migration for movement choices; Barista 404 on another user's shift; post returns 200; report date basis; closed-shift expense not voidable) were verified against the spec by the audit. The post body now also matches §9.4 for the ids.

## Known limits
- The browser UI was **not** exercised by me (no Playwright until Sprint 4); only typecheck, lint, build and the API tests ran. Please run the checklist below.
- Refund of a 0.00 order is allowed (no lines, no shift needed).
- `npm audit` advisories still unreviewed. Arabic strings are still empty (D12).

## Owner manual test checklist
Start: `docker compose up -d --build --wait`, then `docker compose exec backend python manage.py seed_demo` (first time). App: http://localhost:5173. Logins `admin`, `barista1`, `barista2`, password `Demo-pass-123`.
- [ ] Two baristas each open their own shift (different opening cash), sell some cash and card orders, and close from **Shift**. Check expected vs counted vs difference on the report; print it.
- [ ] As barista1 refund a **cash** order and a **mixed** order (Orders → open the order → Refund). The reason is required; the card warning shows. The order shows REFUNDED and the refund card. Check barista1's expected cash dropped by the cash part (and that the seller's shift, if a different barista, did not change).
- [ ] A cash refund with no open shift is refused ("You need an open shift").
- [ ] Try refunding the same order twice: the second is refused.
- [ ] As barista, **Pay from drawer** (e.g. ice 30.00): the shift's expected cash drops. As admin, void it in **Expenses**: the expected cash goes back. After the shift is closed, void is refused.
- [ ] Admin → Suppliers: add one. Purchases → New: 12 packs × 1000 ml of milk, cost per pack; Save; **Post**. Stock goes up once and one expense appears; posting again does nothing; the posted purchase cannot be edited.
- [ ] Admin → Reports: all six pages for today match what you did (sales, payments, top products without refunded orders, stock, purchases & expenses, shifts). Dashboard shows today's numbers.
- [ ] Switch to عربي: layout mirrors (labels fall back to English).
