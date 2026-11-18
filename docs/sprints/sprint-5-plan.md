# Sprint 5 plan — Logic review and fixes

Read: CLAUDE.md, PROGRESS.md, `docs/SYSTEM_LOGIC.md` (the whole logic, checked against the code 2026-11-17), spec §2 (decisions), §7, §8, §11 (Sprint 5).

Status: **implemented (2026-11-17); waiting for the owner's manual test and approval.** Report: `docs/sprints/sprint-5-report.md`. The owner answered every question on 2026-11-17 (below).

Branch: `sprint-5-logic` from `main`. The uncommitted D20 work on `main` comes with it and is part of this sprint.

## The owner's rule for this sprint
> "Profit is what a sale earns: I sell for 100, all my costs (materials, services, anything) are 90, so I made 10. Nothing may enter the system without knowing what it cost and where it came from." (2026-11-17)

## Findings
| # | Finding (owner, 2026-11-17) | Cause found in the code |
|---|---|---|
| L1 | Posted a coffee purchase, but the Ingredients screen still shows the old unit cost. | The screen shows the hand-typed `reference_unit_cost`, which a purchase never changes. Sales and profit use the weighted `avg_cost` on the stock balance (dev DB: typed 1.00/g, real average 0.680851/g). The hint "Informational only" has been wrong since D19. |
| L2 | Net profit = 1,000.00 with no sales. | A +1,000 g adjustment at the typed 1.00/g counts as a "stock gain" (`reports/services.py::profit`). Free stock creates profit. |
| L3 | Review the whole profit cycle; nothing may enter without a known cost and source. | See the table below. |
| L4 | The owner must not work out the cost per unit (500 kg for 785). | A purchase line by quantity needs a **typed unit cost**. |

**L3: what is wrong today**
| Area | Today | Problem |
|---|---|---|
| Opening balance | No cost asked; uses the typed reference cost or stays unknown | Cost missing or made up |
| Adjustment "add" / count surplus | Valued at average/typed cost, counted as a **gain** | Free stock → profit |
| Typed reference cost | Anyone types any number; used until the first purchase | A cost from nowhere |
| Cups, lids, napkins not in recipes | Bought, sit in stock, never become a cost | Profit too high |
| Stock bought with "Pay from drawer" | An expense, stock never goes up | Wrong stock and cost |
| Expense categories | No salaries, no card fees | Costs missing from net profit |
| Card fees | Not recorded | Profit too high |
| Supplier credit | Every purchase counts as paid | Money out is wrong when bought on credit |

## Owner answers (2026-11-17)
| # | Question | Answer |
|---|---|---|
| Q-A | A count finds more than the system | **Not profit**: it only fixes the balance |
| Q-B | Cups, lids, packaging | **Ingredients in the recipe** of each size |
| Q-C | Card fees | **A % in Settings**, recorded automatically |
| Q-D | Current dev data | **Wipe and re-enter** after the fix (backup first) |
| Q-E | Stock that appears after go-live (gift, found) | **Opening balance with a cost and a reason**, Admin only, never profit |
| L4 | "By pack" mode | **Keep it as an option**; the default is quantity + unit + total paid |
| P1 | Shared drawer | **Each barista has their own drawer** (D7 unchanged) |
| P4 | Supplier credit | **Yes, full**: supplier balance and partial payments, in this sprint |
| P6 | Option costs on the Products screen | **Yes**, show each option's cost and margin |
| P7 | Return to stock after a refund | **Yes**, an Admin button |
| P8 | Recalculate cost | **Remove it** after the fix |
| P9 | Purchase date | **Posting day** (unchanged) |
| P11 | Stock report cashier/shift filter, phone Orders table | **In Sprint 5** |
| Cat. | New expense categories | **Salaries, Card fees, Marketing, Taxes & fees** |
| Old file | `LOGIC_REVIEW.md` | **Delete** |
| Q3 | Commits | No commits until Sprint 5 is approved; descriptive commits (D20 separate); then push |

P2 (stock change with no cost) and P3 (opening stock with no price) are solved by T1–T3: every movement gets a known cost.

## Tasks

### The stock and cost cycle
- [x] **T1 One cost per ingredient, from a real source (L1, L3)**
  - `unit_cost()` uses only the weighted average on the balance. The typed `reference_unit_cost` is no longer a fallback.
  - Migration: where a balance has stock, no average and a typed cost, the average is set from the typed cost (so nothing already sold changes), then the column is dropped. Reviewed, no other data changes.
  - Ingredients screen: the typed cost field goes away. New read-only columns: **Stock** and **Average cost** (Admin only). The wrong hints are fixed.
  - An ingredient with no average cost (never stocked) cannot be sold: quote and checkout return 422 `COST_MISSING` (new error code, like `RECIPE_MISSING`) with the ingredient names. The POS greys the product with "No price — ask an Admin". The Products screen and the Dashboard alerts show it.
- [x] **T2 Opening balance with a cost (L3, Q-E, L4)**
  - Each line: ingredient + quantity + unit + **total value** (required); the system works out the cost per unit.
  - Allowed any time (not only before the first movement), Admin only. A reason is **required** after the ingredient's first movement (e.g. "Gift", "Found in storage").
  - It changes the stock and the weighted average (same formula as a purchase). It is never money out and never profit. Audited.
- [x] **T3 Adjustments only remove, counts only fix (L2, Q-A)**
  - "Add quantity" is removed. The adjustment is a **loss** only (waste, spoiled, broken) with a required reason, valued at the average, and counts as **Losses** in profit.
  - Physical count: a shortage = a loss. A surplus fixes the balance at the average cost and is **not profit** (shown as information: "Count surplus, not profit: X").
  - The Adjustment tab warns: "Bought it? Record it as a purchase. Already had it? Use an opening balance."
  - The API refuses a positive `qty_delta` (400). Old movements stay as they are. The profit report applies the new rule to every period (positive adjustments never count).
- [x] **T4 Purchase lines: quantity + total paid (L4)**
  - Default line: ingredient + quantity + **unit** (g/kg, ml/L, pcs, converted to the base unit) + **total paid**. The cost per unit is shown, never typed. The line total is the typed total exactly.
  - "By pack" stays as the second mode. "By quantity + unit cost" is removed (API too).
  - Tests: 500 kg / 785 → 500,000 g, line 785.00, exact average; a wrong unit for the ingredient → 400; edit a draft and save it again.
- [x] **T5 Supplier credit (P4)**
  - When posting a purchase: **Paid now** (as today: external or drawer, one expense) or **On credit**.
  - On credit: stock and average cost go in at once. No money goes out, and the purchase shows **Owed: X**.
  - **Supplier payment** (new, Admin): supplier, purchase(s) it pays, amount (partial allowed, never more than owed), from the drawer (needs your open shift, lowers expected cash) or external (cash/card/transfer), date = when recorded. Idempotent, audited, voidable with a reason (an open shift only for drawer ones).
  - Suppliers screen: an **Owed** column. A supplier page lists purchases with paid / remaining, plus the payments.
  - A credit purchase that has payments cannot be voided until the payments are voided (409).
  - Reports: Money in & out counts supplier payments on their date ("Supplier payments" row). Profit is unchanged (the cost comes in with the stock when it is sold). New Dashboard tile: "We owe suppliers: X".
- [x] **T6 Card fees (Q-C)**
  - Settings: **Card fee %** (0–100, default 0).
  - Checkout saves the fee on each card payment (`fee_amount`, a snapshot: changing the % later never changes old sales).
  - Profit: "Card fees" row under expenses. Money in & out: "Card fees" as money out.
  - A card refund keeps the fee (banks keep it). The **Card fees** category stays for manual bank corrections.
- [x] **T7 Expense categories**: add Salaries, Card fees, Marketing, Taxes & fees (en/ar). "Pay from drawer" hint: "For stock you buy (milk, coffee…) use a drawer purchase."
- [x] **T8 Packaging in the recipe (Q-B)**
  - No new model: cups, lids etc. are ingredients in `pcs` on each size's recipe.
  - `seed_demo` gets cups/lids. The Products screen recipe hint mentions packaging. The user guide (Sprint 6) explains it.
- [x] **T9 Return to stock after a refund (P7)**
  - On a refunded order, the Admin gets **Return to stock**: the order's ingredients and quantities are listed (from the sale's consumption snapshot), and each line can be lowered or set to 0. A reason is required.
  - It goes back at the **cost it left at** (snapshot), and the average is recalculated. Once per order, idempotent, audited.
  - Profit: "Returned to stock" lowers the cost of what was sold, in the period of the return.

### Reports and screens
- [x] **T10 Profit report like the owner's example (L3)**
  ```
  Net sales (before tax, minus refunds)
  − Cost of what was sold (ingredients + packaging) + returned to stock
  = Gross profit                         (margin %)
  − Losses (waste, count shortages)
  − Expenses, by category (salaries, rent, bills…) and card fees
  = Net profit
  Out of every 100 sold: X cost · Y losses · Z expenses · W profit
  ```
  "Stock gains" is removed. Info lines: purchases this period (became stock), count surplus (not profit), supplier credit owed.
- [x] **T11 Remove Recalculate cost (P8)**: the button, the `POST /orders/recost` endpoint and its tests go. Orders already marked "estimate" keep the mark. D20's "can't calculate" stays for old data.
- [x] **T12 Option costs on the Products screen (P6)**: under each size, the recipe cost, then each linked option: extra cost, extra price and the margin with it.
- [x] **T13 Stock report filter (P11)**: `cashier_id` / `shift_id` filter the consumed column (sales by that cashier/shift). Spec §8.13.
- [x] **T14 Phone Orders table (P11)**: on a phone, each order is a card (invoice, time, total, status) instead of a sideways-scrolling table. Playwright phone check.

### Data, docs and checks
- [x] **T15 Dev data (Q-D)**: at the end, back up the dev DB (`db-backups/`), wipe it, run the updated `seed_demo`. You re-enter your real test data with the new rules.
- [x] **T16 Docs**: `SYSTEM_LOGIC.md` rewritten for the new cycle (stock in/out table, profit, credit, card fees). Spec §2 (new decision D21 "profit cycle"), §7, §8, §9 (new endpoints, `COST_MISSING`), §10 updated. Delete `LOGIC_REVIEW.md`. PROGRESS updated.
- [x] **T17 Tests**
  - Every rule above gets a test.
  - Permission matrix: new routes are Admin only; costs, fees and owed amounts are never in Barista responses.
  - Full-day reconciliation test extended: opening balance with cost, credit purchase, partial payment, card fee, loss, count surplus, refund + return to stock. Every pound and gram adds up.
  - Playwright: credit purchase → payment; opening balance; POS blocked for an ingredient with no price.
- [x] **T18 Full check suite** (§4.4), Sprint 5 report, then your manual test.

## Assumptions (tell me if any is wrong)
1. **`COST_MISSING` blocks the sale** (T1). This is the strict form of "nothing enters without a known cost". In practice it only happens for an ingredient that was never stocked.
2. A card refund keeps its fee (T6).
3. A supplier payment can pay several purchases of the same supplier at once (split by you); it can never pay more than is owed.
4. Old ledger rows are never edited. The new profit rules apply to every period, so a past day with a positive adjustment shows a different net profit after the fix. That is wanted (L2).

## Rules for the fixes
- The spec wins (CLAUDE.md). Idempotency, locking, snapshots, audit, permissions and tests are never simplified.
- **Old records never change**; past data only through the reviewed migration in T1.
- Every rule change has a test, and the reconciliation tests still add up.
- Costs and profit are never sent to a Barista.
- New texts go into `en.json` and `ar.json` (Arabic filled, `i18n:check`).

## Owner manual test checklist (draft)
- [ ] Opening balance: coffee 2 kg worth 300 → the Ingredients screen shows 2,000 g at 0.15/g.
- [ ] Purchase 500 kg for 785, paid now → the average updates and Money out shows 785.
- [ ] Purchase on credit → Owed shows; pay half from the drawer → expected cash goes down, Owed halves.
- [ ] Sell a drink with a cup and a lid in the recipe → the order's cost includes them.
- [ ] Card sale with a 2 % fee → Profit shows the card fee.
- [ ] Waste 100 g → Losses. Count surplus → balance fixed, net profit unchanged.
- [ ] Refund, then return to stock → stock back, cost of sales lower.
- [ ] Profit report reads like the 100 → 10 example.
- [ ] A Barista sees no cost, fee or owed amount anywhere.

## Exit criteria
Every finding is fixed with tests. `SYSTEM_LOGIC.md` and the spec match the code. Full check suite and CI green. Your manual test passes.
