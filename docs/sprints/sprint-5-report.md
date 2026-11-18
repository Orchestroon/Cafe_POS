# Sprint 5 report — Logic review and fixes

Plan: `docs/sprints/sprint-5-plan.md` (approved by the owner 2026-11-17). Logic, explained for the owner: `docs/SYSTEM_LOGIC.md`. Spec: new decision **D21** (Section 2), plus Sections 7, 8.7, 8.9, 8.13, 9.

Status: **implemented, waiting for your manual test and approval.** Nothing is committed yet (your rule). Branch `sprint-5-logic`, which also carries the uncommitted D20 work.

## Your rule for this sprint
> "I sell for 100, all my costs are 90, so I made 10. Nothing may enter the system without knowing what it cost and where it came from."

## What changed
| # | What | Where you see it |
|---|---|---|
| L1 | The hand-typed ingredient cost is **gone**. An ingredient has one cost: its average, from purchases and opening balances. | Ingredients: new **In stock** and **Average cost** columns (per kg / L / piece) |
| L2, Q-A | **Stock is never added by hand.** An adjustment only takes stock out (waste, spoiled, broken) and counts as a loss. A count that finds more only fixes the balance and is **never profit**. | Inventory → Adjustment (warning at the top) |
| L3, Q-E | **Opening balance needs its total value**, at the start or later (gift, found in storage) with a reason. | Inventory → Opening balances: quantity, unit, total value, the cost per unit shown |
| L3 | **Nothing is sold without a known cost.** An ingredient that was never stocked with a value blocks the sale ("an ingredient has no price yet, ask an Admin"). | Till error; Dashboard tile and alert "Ingredients without a price" |
| L4 | **A purchase line is quantity + total paid** ("500 kg for 785"); the system works out the cost per unit (1.57 / kg). "By pack" stays as the second way. | Purchases → New |
| P4 | **Buying on credit.** Post "On credit": stock and cost go in, no money out. **Pay supplier**: one or more invoices, in full or in part, from the drawer or outside. Void a payment with a reason. | Purchases (Payment: Paid now / On credit), Suppliers (Owed, Pay supplier, Payments), Dashboard "We owe suppliers", Money in & out |
| Q-C | **Card fee %** in Settings; each card sale saves its fee (old sales never change). A refund keeps the fee. | Settings → Card fees; Profit and Money in & out show it |
| Cat. | New expense categories: **Salaries, Marketing, Taxes & fees, Card fees.** The expense dialog says: stock you buy is a purchase. | Expenses |
| Q-B | Cups and lids are ingredients in the recipe. The demo data has a cup and a lid in every size. | Products |
| P7 | **Return to stock** after a refund (Admin): up to what the order used, at the cost it left at; lowers the cost of sales. Once per order. | Order detail of a refunded order |
| L3 | **Profit report** reads like your example: net sales − cost of what was sold − losses − expenses by category − card fees = net profit, plus **"Out of every 100 sold"**. "Stock gains" is gone. | Reports → Profit |
| P8 | **Recalculate cost removed** (every new sale has a cost). | Reports → Profit |
| P6 | **Option costs** on the Products screen: each linked option's extra cost, extra price and margin. | Products → a size → Consumption preview card |
| P11 | **Stock report** consumed column by cashier or shift. **Orders** list is cards on a phone. | Reports → Stock; Orders on a phone |
| Q-D | Your test data was **backed up** to `db-backups/drip-before-sprint5-20261117-2353.sql`, wiped, and the demo data loaded with costs. | Log in as admin / Demo-pass-123 |
| — | `docs/LOGIC_REVIEW.md` deleted; `SYSTEM_LOGIC.md` rewritten for the new cycle. | docs |

## Data migration (reviewed)
- `inventory 0004`: where an ingredient had stock, no average and a typed cost, the typed cost became its average (so stock already in the café keeps the cost it was sold at); then the typed cost column is dropped. No ledger row is changed.
- New tables / columns only: supplier payments, credit fields on purchases, card fee on settings and payments, stock returns, opening value on adjustments, new movement and expense types.

## Checks (all green)
- Backend: **714 tests pass**, 99 % coverage; ruff, format, migrations check, OpenAPI schema validation.
- Frontend: typecheck, lint, i18n check (938 keys, Arabic complete), **29 unit tests**, build.
- Browser (Playwright, separate stack): **48 tests pass**, including 3 new ones: purchase by quantity + total, credit purchase paid in part, opening balance with value and adjustment that only removes stock.
- New backend tests cover every rule: no sale without a cost, adjustments only out, a count surplus is never profit, opening balance with value and reason, credit purchase / partial payments / never more than owed / voids / two payments at the same moment, card fees (snapshot, kept on refund), return to stock, stock report by cashier and shift, the profit report with returns, losses, categories and per 100, and the permission sweep (costs, fees, owed amounts never reach a Barista).

## Deviations and things to know
1. **The till does not grey out a product whose ingredient has no price** (it does for a missing recipe). The sale is refused with a clear message when the product is added, and the Dashboard and alerts list the ingredients. Greying it out in advance would need the cost status of every product sent to the till; tell me if you want it.
2. A card refund keeps its fee as a cost (banks keep their commission).
3. One supplier payment can pay several invoices of the same supplier; never more than is owed.
4. The new profit rule applies to every period: a past day with a manual "add" adjustment now shows a different net profit (that was L2).
5. Old orders sold without a cost (before D19) still show "Can't calculate"; nothing new can create one.

## Your manual test checklist
- [ ] Ingredients: each row shows **In stock** and **Average cost** (e.g. Coffee Beans 5 kg at 800.00 / kg); there is no cost field to type.
- [ ] Purchases → New: Coffee Beans, **500 kg, total paid 785** → cost per unit 1.57 / kg; Save, Post → the coffee's average cost changes.
- [ ] Suppliers → New supplier. Purchases → New with that supplier, **Payment: On credit** → Post → "Owed". **Pay supplier** 100 from the drawer (open your shift first) → Owed goes down, your shift's expected cash goes down by 100.
- [ ] Inventory → Adjustment: you can only **remove** stock (waste) or count. Inventory → Opening balances: a quantity with its total value; a reason is asked if the ingredient already has stock.
- [ ] Settings → Card fees 2 %. Sell a drink by card → Reports → Profit shows **Card fees**.
- [ ] Sell, refund, then on the order **Return to stock** a cup → Profit's cost of sales goes down.
- [ ] Reports → Profit: the rows read like the 100 → 10 example, with "Out of every 100 sold".
- [ ] Products → Iced Latte → a size: the options table shows Oat Milk and Extra Shot with their extra cost and margin.
- [ ] As **barista1**: no cost, fee or owed amount anywhere; a product with an ingredient without a price cannot be sold.
- [ ] Arabic: switch to عربي and look over the new texts.

## Next
After your approval: commits (D20 separate from Sprint 5, descriptive messages), then push. Then Sprint 6 (release readiness), whose plan is re-checked against this sprint (the catalog import must take opening stock **with its value**).
