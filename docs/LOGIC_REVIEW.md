# Logic review — products, recipes, stock and cash

> **Temporary document.** Written for the owner's review (2026-11-11). Delete it after the review; any decision taken goes into `PROJECT_SPEC.md` and the Sprint 4 plan.

Each section says how the system works **today** (checked in the code), then lists the gaps with a suggested fix. Nothing here has been changed yet.

---

## 1. Products

```
Category ──► Product ──► Size (variant) ──► price
                 │            │
                 │            └──► Recipe (per size)
                 └──► Modifier groups (Milk Type, Extras…) ──► Options ──► price per size + stock effects
```

- A **product** (Iced Latte) belongs to a **category** (Cold Drinks).
- A product has one or more **sizes** (Small / Medium / Large). Each size has its own **price**. The till sells sizes, not products.
- **Modifier groups** are linked to a product. Each group has options (Oat Milk, Extra Shot), a min/max number of choices, and a mode:
  - **add**: the option adds ingredients (Extra Shot adds coffee);
  - **replace**: the option removes one recipe line and puts its own ingredient instead (Oat Milk replaces the line marked `milk`).
- An option's price can be different per size (Oat Milk on Large = 20).
- Nothing is deleted: products, sizes, groups and options are only deactivated. A deactivated item is hidden from the till; old orders keep their own copy (snapshot) of names and prices.

Where in the app: **Admin → Categories**, **Admin → Products** (sizes and modifier links), **Admin → Modifiers**.

## 2. Recipes and what a sale consumes

**Where:** recipes belong to a **size**. Admin → Products → open the product → the **Recipe** button next to each size. There is no separate Recipes page.

A recipe line = ingredient + quantity + waste % + an optional slot name (like `milk`, used by replace options).

**What one sale deducts** (for each item in the cart):
1. Start from the size's recipe lines.
2. For each chosen **replace** option: remove the recipe line with that slot, add the option's ingredient.
3. For each chosen **add** option: add the option's ingredients.
4. Each line: `quantity × (1 + waste %)`, waste counted once. Example: 12 g coffee + 5% = 12.600 g.
5. Multiply by the item quantity, add up per ingredient, deduct from stock.

```
Large Iced Latte + Oat Milk + Extra Shot
  recipe:  Coffee 18 g, Whole Milk 250 ml (slot milk), Ice 150 g
  Oat Milk replaces slot "milk"  →  Whole Milk removed, Oat Milk 250 ml added
  Extra Shot adds                →  Coffee +9 g
  deducted: Coffee 27 g, Oat Milk 250 ml, Ice 150 g   (no Whole Milk)
```

- The order keeps a copy of the recipe it used and of what it deducted. Editing a recipe later never changes old orders.
- If a replace option is chosen but the size's recipe has no matching slot, the sale is refused (`INVALID_MODIFIER`, slot missing), and the Admin sees a warning on the recipe and the group.

### Gaps
| # | What happens today | Risk | Suggested fix |
|---|---|---|---|
| R1 | **A size with no recipe sells with no stock deduction**, with no warning anywhere. (This is the case you found.) | Stock is never reduced for that product; nobody notices. | **Approved (option A), Sprint 4:** a size with no recipe cannot be sold (`RECIPE_MISSING`) unless the Admin ticks "No stock tracking" on that size; "No recipe" badge on Products; list on the Dashboard. |
| R2 | **An option with no stock effects** (e.g. a new "Caramel" option added without an ingredient) sells with no stock deduction for that option, with no warning. | Same as R1, for extras. | Same rule as R1: an option needs at least one effect or an explicit "No stock effect" tick; badge on the Modifiers page. **Your decision.** |
| R3 | A recipe whose ingredient was later deactivated still deducts that ingredient. | None — stock is really used. Correct. | No change. |

## 3. Stock (inventory)

**One stock location** in v1 (spec D3/D4). It exists in the database but has no screen, because there is nothing to choose. Multi-warehouse and transfers are out of scope for v1.

Every change to stock is one line in the **movements ledger** (Admin → Inventory → Movements). A movement can never be edited or deleted. Each one stores the quantity, the type, who did it, and the balance after it.

```
                  ┌──────────────────── Stock balance (per ingredient) ────────────────────┐
  + Opening balance (once, before any movement)                                         │
  + Purchase post  (Admin → Purchases → Post)                                            │
  − Sale           (every checkout, from the recipe, see section 2)                      │
  ± Adjustment     (Admin → Inventory: add/remove with a reason, e.g. spoiled milk)      │
  = Count          (Admin → Inventory: type the counted qty; the difference is posted)   │
                  └─────────────────────────────────────────────────────────────────────────┘
```

- **Opening balance:** only for an ingredient that has no movement yet. After that, use a count.
- **Negative stock is allowed.** A sale with too little stock still goes through; the till shows a warning and the balance goes below zero, so the shortage is visible and auditable.
- **Refunds do not return stock** (owner decision, spec 8.6.8): the drink was made. If something can go back to stock, the Admin makes an adjustment.
- Two sales of the same ingredient at the same moment cannot lose an update (row locks, tested).

### Gaps
| # | What happens today | Risk | Suggested fix |
|---|---|---|---|
| S1 | Ingredient cost (`reference cost`) is typed by hand. Posting a purchase does **not** update it. | The cost shown can be old. No report uses it today, so no wrong figure is shown. | v1: leave as is. Later: update the cost from the last purchase or an average. **Your decision.** |
| S2 | There is no profit / cost-of-goods report. | You see sales and expenses, not the margin per drink. | Not in the v1 spec. Later (after v1). |
| S3 | After a refund, the Admin must remember to adjust stock by hand. | Forgotten adjustments. | Optional: on a refunded order, an "Adjust stock" link for the Admin. **Your decision.** |

## 4. Cash and money

### Shift (per user)
Each user opens **their own shift** with the cash they start with (spec D7). They need an open shift to sell, to refund cash, or to pay from the drawer.

```
Expected cash = opening cash
              + cash sales          (cash part of each payment, change already taken out)
              − cash refunds        (refunds made by THIS user during this shift)
              − drawer expenses     ("Pay from drawer", and purchases paid from the drawer)

At close:  counted cash (typed by the user)  −  expected cash  =  difference
           (negative = cash missing, positive = extra cash)
```

- **Card** sales and card refunds are shown on the shift but do not change expected cash.
- **Mixed** payment: the cash part counts as cash, the card part as card.
- A **refund** is paid by whoever does it, from their own open shift — even if another barista made the sale. The seller's shift does not change.
- Closing freezes the figures; later changes (e.g. a void) can no longer touch a closed shift.

### Money out (expenses)
```
Expense
 ├─ from the drawer  → needs the payer's open shift → lowers expected cash
 │     ├─ "Pay from drawer" (Barista or Admin)
 │     └─ a purchase posted with source = drawer
 └─ external (bank, owner's pocket…) → Admin only → does not touch any shift
       ├─ a general expense
       └─ a purchase posted with source = external
```

- Posting a purchase creates the stock movements **and exactly one expense**, once (posting twice does nothing).
- An Admin can void a general expense (not a purchase expense, and not a drawer expense of a closed shift).

### Reports
Sales, payments (cash / card), refunds and expenses come only from saved records. Sales and payments are dated by the order time; refunds by the refund time; expenses by the paid time — so the totals always add up for any day.

### Gaps
| # | What happens today | Risk | Suggested fix |
|---|---|---|---|
| C1 | Shifts are per user. If **two baristas work at the same time with one physical drawer**, each one has their own expected cash, but the drawer holds both. | The two counts at close cannot be checked separately; differences look wrong. | Tell me how the café works: one drawer per barista, or one shared drawer? If shared, the rule should be "one open shift per register" instead of per user. **Your decision — this changes D7.** |
| C2 | A new shift's opening cash is not compared with the last shift's counted cash. | Cash between shifts is not tracked. | Optional: show "last shift closed with X" when opening, and record the difference. **Your decision.** |
| C3 | There is no "cash in" (put money into the drawer mid-shift) or "cash drop" (move money to the safe). | — | You said ignore this for now. |

---

## Decisions I need from you
1. **R2** — same rule as recipes for options with no stock effect?
2. **S1** — keep the hand-typed cost for v1?
3. **S3** — "Adjust stock" link on refunded orders?
4. **C1** — one drawer per barista, or a shared drawer?
5. **C2** — compare opening cash with the last close?
