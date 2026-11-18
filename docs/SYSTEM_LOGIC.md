# How the system works — the whole logic

> Written for the owner's review (2026-11-17). It describes how the system works **today**, checked in the code, including the D20 fix (missing costs). The technical contract is `PROJECT_SPEC.md`; if the two ever disagree, tell me and we fix one of them.
>
> Checked again on 2026-11-17 against the running code, with tests for every section (`backend/apps/reports/tests/test_system_logic.py` adds the stock value equation, profit with tax, and a refund on a later day).
>
> Updated for Sprint 5 (logic review and fixes, 2026-11-17). Section 12 lists the decisions taken.

---

## 0. The big picture

```
 Supplier ──► Purchase ──► Stock (+) ──► average cost per ingredient
   ▲             │   (paid now or on credit)    ▲   │
   │             └──► Expense (money out)        │   │
   └── Supplier payment (credit, later)          │   │
 Opening balance (with its value) ───────────────┘   ▼
 Product ──► Size ──► Recipe (ingredients) ──► Sale ──► Stock (−) and cost saved on the order
                                                │
                                                ├──► Payment (cash / card) ──► Shift (expected cash)
                                                └──► Refund (money back; unused items: Return to stock)

 Shift:   opening cash + cash sales − cash refunds − drawer expenses ± cash out/in = expected cash
 Reports: Money in & out · Profit · Sales · Payments · Top products · Stock · Purchases & expenses · Shifts
```

Three basic rules hold everywhere:

1. **Nothing is deleted.** Products, sizes, ingredients, suppliers and users are switched off, not deleted. Purchases and expenses are voided, with a reason. Orders are refunded, never removed.
2. **Every important action is in the audit log**: who, when, and what changed.
3. **Old records never change when you edit something.** Each order keeps its own copy of the names, prices, recipe and cost at the moment of sale. If you change a recipe or price tomorrow, yesterday's orders stay the same.

**Numbers:**
- Money has 2 decimals. Quantities have 3 decimals. Costs per unit have 6 decimals.
- Rounding is half-up: 0.005 → 0.01.
- Decimal numbers are never used as "floating point", so no pound is lost to rounding errors.

---

## 1. People and roles

| | Admin | Barista |
|---|---|---|
| Sell, take payment, print receipts | ✓ | ✓ |
| Open / close **own** shift | ✓ | ✓ |
| Close **another** person's shift | ✓ | ✗ |
| Refund an order (full, with reason) | ✓ | ✓ |
| Pay an expense **from the drawer** (own shift) | ✓ | ✓ |
| Cash out / in of the drawer (own shift) | ✓ | ✓ |
| Cancel a cash out / in entry | ✓ | ✗ |
| External expenses, void expenses | ✓ | ✗ |
| Products, recipes, modifiers, ingredients, stock | ✓ | ✗ |
| Suppliers, purchases, void purchase, supplier payments | ✓ | ✗ |
| Return to stock after a refund | ✓ | ✗ |
| Reports, audit log, users, settings | ✓ | ✗ |
| See costs, card fees, what we owe, profit | ✓ | ✗ (never sent to the barista) |

**Order history:** a barista sees today's orders, can find any order by its invoice number, and can open any order by its link.

**Last Admin:** the last active Admin cannot be switched off or changed to Barista.

---

## 2. Products, sizes and options

```
Category ──► Product ──► Size ──► price
                 │         └──► Recipe (per size)
                 └──► Option groups (Milk type, Extras…) ──► Options ──► price per size + ingredients
```

**Products and sizes**
- The till sells **sizes** (Iced Latte **Large**), not products. Each size has its own price.

**Option groups**
- **Add** group: the option adds ingredients. Extra Shot adds 9 g coffee.
- **Replace** group: the option swaps one recipe line. Oat Milk replaces the line marked `milk`.
- **Price per size:** an option can cost different amounts on each size. Oat Milk is +15 on Small and +20 on Large.
- **How many to choose:** each group has a minimum and a maximum. The till refuses a choice outside them.

**Packaged goods** (water bottle, cookie)
- Set up as an ingredient counted in pieces, with a one-line recipe: 1 piece.

**Service item with no stock** (e.g. a service charge)
- Tick "No stock tracking" on the size.
- A normal size with **no recipe cannot be sold**. The till greys it out until the recipe is set up, so stock is never silently skipped.

**Selling price**
- Unit price = size price + the price of each chosen option.
- **Promotions are not built yet.** The discount is always 0, and the order screens have room for it later.
- **Line total** = unit price × quantity.
- **Tax** is off until the Admin turns it on. When it is on, it is added on top of the menu price, unless "prices include tax" is chosen.

---

## 3. Ingredients and stock

**Units**
- Stock is kept in **grams, ml or pieces**.
- Screens let you type kg or litres; the system always stores the small unit.

**The rule (Sprint 5, owner 2026-11-17): nothing enters stock without a known cost and a source.** Stock comes in only three ways:

| Way in | Cost | Money | Profit |
|---|---|---|---|
| **Purchase** (posted) | what was paid | out now (paid now) or later (on credit, section 4) | never; it becomes a cost when sold or lost |
| **Opening balance** | its **total value is required** | none: it was already in the café | never |
| **Count surplus** (counted more than the system shows) | today's average cost | none | **never**; it only fixes the balance |

Stock goes out in these ways:

| Way out | Cost | Profit |
|---|---|---|
| **Sale** | average cost at sale time, saved on the order | cost of what was sold |
| **Loss**: adjustment (waste, spoiled, broken) or count shortage | average cost | **Losses** |
| **Purchase void** | the price of that purchase | none (the purchase is undone) |

And one more way back in:
| **Return to stock** after a refund (Admin) | the cost it left at | lowers the cost of what was sold |

**Every stock change is one line in the movements ledger.** A line can never be edited or deleted. Each line keeps the quantity, the type, who did it, the balance after it and the **cost per unit** at that moment.

**Opening balance**
- For stock that is in the café without a purchase in the system: at the start, or later (a gift, a carton found in storage).
- Each line: ingredient + quantity + **total value**. The system works out the cost per unit (e.g. 2 kg worth 300 → 0.15 per g) and weighs it into the average like a purchase.
- **A reason is required** once the ingredient already has stock.

**Adjustments only take stock out.** "Add quantity" was removed: stock you bought is a purchase, stock you already had is an opening balance. A count can go either way, but extra stock found is never profit.

**The ingredient's cost**
- There is one cost per ingredient: its **average cost** (section 4). It is never typed. The Ingredients screen shows the stock and the average cost (per kg / L / piece).
- **An ingredient with no cost cannot be sold:** the whole cart is refused with "an ingredient has no price yet, ask an Admin" (`COST_MISSING`). This only happens for an ingredient that was never stocked; the Dashboard and the alerts list them.
- **No cost, no adjustment:** a loss or a count also needs a known cost, so every movement has a value.

**Stock rules**
- **Negative stock is allowed.** A sale with too little stock still goes through, with a warning. The balance goes below zero, so the shortage is visible.
- **Refunds do not return stock by themselves** (the drink was made). For an item that was not used, the Admin uses **Return to stock** (section 6).
- **An ingredient used by a recipe or an option cannot be switched off.**
- **No two-sales mix-up:** the stock row is locked during a sale, so no update is lost.
- **Packaging is an ingredient:** cups, lids, sugar sachets are counted in pieces and put in each size's recipe, so each sale carries their cost.

---

## 4. Suppliers and purchases

**Suppliers**
- Name, phone, notes, and **Owed**: what we still owe them for purchases on credit.

**The life of a purchase**

```
Draft  ──(Post)──►  Posted  ──(Void, Admin, reason)──►  Voided
  │                    │
  └ can be edited      ├─ stock goes up (one movement per line)
    or deleted         ├─ the average cost of each ingredient is updated
                       └─ Paid now:  ONE expense today (the money out)
                          On credit: no money yet; "Owed" = total, paid by supplier payments
```

**A line is what you bought and what you paid** (Sprint 5 L4): "500 kg for 785".
- **Quantity + total** (default): type the quantity, its unit (kg or g, L or ml, pieces) and the total paid. The system works out the cost per unit (1.57 per kg = 0.00157 per g). The line total is exactly what you typed.
- **By pack:** packs × pack size at a price per pack. Example: 10 packs × 160.75 = **1,607.50** exactly.
- The cost per unit is never typed.

**Paid now** (from where):
- **From the drawer:** needs the poster's own open shift, even for an Admin. The cash comes out of that shift's expected cash.
- **External** (bank, card, owner's pocket): no shift is affected.

**On credit** (Sprint 5 P4)
- Needs a supplier. Posting adds the stock and its cost; **no money goes out**.
- **Supplier payment** (Admin, Suppliers or the purchase screen): pays one or more of that supplier's credit purchases, **in full or in part**, never more than what is owed. From the drawer (your open shift) or external. It is one expense on the day it is paid.
- An Admin can void a supplier payment with a reason: the amount is owed again. A drawer payment of a closed shift cannot be voided.
- A purchase that has payments cannot be voided until its payments are voided.

**Posting twice** does nothing the second time, even if the internet drops and the button is pressed again. The same holds for a supplier payment.

**Voiding a posted purchase** (Admin, reason required)
- The stock is taken back out (it may go negative if some was used).
- The average cost goes back to what it would have been without that purchase.
- The expense is cancelled (paid now). Refused for a drawer purchase whose shift is already closed.

### Average cost (how each ingredient gets its cost)

**After each purchase, opening balance or return to stock:**

```
new average = (stock on hand × old average  +  quantity in × its cost)
              ──────────────────────────────────────────────────────────
                          stock on hand  +  quantity in
```

Example (coffee):
- Opening balance: 1 kg worth 1,000 → **1.00 per g**.
- Buy 1 kg for 400 → (1,000 + 400) ÷ 2 kg → **0.70 per g**.
- Buy 1 kg more for 460 → (2 kg × 0.70 + 460) ÷ 3 kg → **0.62 per g**.

**Special cases**
- **Nothing on hand** (zero or negative stock): the new cost becomes the average.
- **Selling and losses do not change the average.** Purchases, voids, opening balances and returns do.

---

## 5. A sale, step by step

1. **The cart is priced** (section 2) and the stock it needs is calculated:
   - Start from the size's recipe.
   - **Replace** options swap their line. **Add** options add theirs.
   - Each line: quantity × (1 + waste %). Waste is counted once. Example: 12 g + 5% = 12.6 g.
   - × the item quantity. Then everything is added up per ingredient.

   ```
   Large Iced Latte + Oat Milk + Extra Shot
     recipe:  Coffee 18 g, Whole Milk 250 ml (slot "milk"), Ice 150 g, Cup 1, Lid 1
     Oat Milk replaces "milk"  →  Whole Milk out, Oat Milk 250 ml in
     Extra Shot adds           →  Coffee +9 g
     taken from stock: Coffee 27 g, Oat Milk 250 ml, Ice 150 g, Cup 1, Lid 1
   ```
2. **Every ingredient must have a cost** (section 3), otherwise the cart is refused.
3. **The cashier must have an open shift.**
4. **If the price changed since the screen showed it,** the sale is stopped and the new price is shown. No wrong price is ever charged.
5. **Payment:**
   - Cash, card, or both (one of each at most). The payments must add up to the total exactly.
   - **Cash:** change = cash given − amount. **Card:** the terminal reference is optional.
   - **Card fee:** the % in Settings × the card amount is saved on the payment (a snapshot: changing the % later never changes old sales).
   - **A 0.00 order** takes no payment.
6. **The invoice number** is the next one: `POS-0000007`. Numbers have **no gaps**.
7. **Stock goes down,** one movement per ingredient. **The cost is saved on the order:** item cost = Σ (quantity used × average cost at that moment); order cost = Σ item costs.
8. **The audit log** records the sale.

**One step:** everything above happens in one step. If anything fails, nothing is saved.

**Safe retries:** pressing Pay twice, or a lost internet answer, never makes two orders.

---

## 6. Refunds

- **Full refunds only.** A reason is required. Any Admin or Barista can refund any paid order.
- **Money goes back the way it came.** A mixed order (100 cash + 40 card) gives back 100 cash + 40 card.
- **Cash comes out of the person who does the refund,** from their own open shift.
- **Card refunds are done on the card terminal by staff.** The card fee stays a cost (the bank keeps it).
- **The order keeps its cost.** The ingredients were really used.
- **Return to stock** (Admin, Sprint 5 P7): for an item that was not used (a sealed bottle), the Admin puts back up to what the order used, per ingredient, with a reason. It comes back at the cost it left at and **lowers the cost of what was sold** in the period of the return. Once per order.
- **The order stays in the list,** marked Refunded, with the same invoice number.

---

## 7. Shifts and the cash drawer

**Each person has their own shift and drawer** (D7, confirmed again 2026-11-17). You need an open shift to sell, refund cash, pay from the drawer (expense, purchase or supplier payment), or take cash out / put cash in.

**Expected cash**

```
Expected cash  =  opening cash
               +  cash sales                (the cash part of each payment; change already taken out)
               −  cash refunds              (refunds this person made in this shift)
               −  drawer expenses           (expenses, purchases and supplier payments paid from the drawer)
               +  cash put in               (e.g. change from the safe)
               −  cash taken out            (e.g. to the safe)

At close:   counted cash  −  expected cash  =  difference   (minus = cash missing, plus = extra)
```

- **Card money** is shown on the shift but never changes expected cash.
- **Cash out / in** needs a reason. It **is not an expense** and never touches profit; it only moves cash. An Admin can cancel an entry while the shift is open.
- **Gap between shifts:** opening cash is compared with **your own** last close.
- **Closing freezes the shift:** nothing paid from a closed shift's drawer can be voided later.
- **Forgotten shifts:** an Admin can close another person's shift.

---

## 8. Expenses (money out that is not a sale refund)

| Kind | Who | Effect |
|---|---|---|
| **General, from the drawer** (cleaning, transport…) | Barista or Admin, own open shift | − expected cash of that shift; counts in profit |
| **General, external** (rent, salaries, bills by bank) | Admin | no shift; counts in profit |
| **Purchase expense** | Created by posting a purchase paid now | money out; **not** in profit (it became stock) |
| **Supplier payment** | Created by paying a credit purchase | money out on the day paid; **not** in profit (the stock is) |

**Categories:** salaries, rent, utilities, maintenance, supplies, transport, cleaning, marketing, taxes & fees, card fees, other.

**Rules**
- **Stock you buy is never a general expense.** Milk bought with drawer money is a purchase "from the drawer", so the stock and its cost go in. The expense screen says so.
- Expenses are never edited. An Admin can **void** a general expense with a reason; it disappears from every report and from expected cash.
- A purchase expense or supplier payment is voided only through its purchase or payment.

---

## 9. Cost and profit

**Profit is what the sales earned** (owner, 2026-11-17: "I sell for 100, all my costs are 90, so I made 10").

```
  Sales (before tax)                         Σ order totals − tax, orders made in the period
− Refunds                                    the same, for orders refunded in the period (refund day)
= Net sales
− Cost of what was sold                      Σ cost saved on each order at sale time
                                             − value returned to stock after refunds
= Gross profit            (margin % = gross profit ÷ net sales; shown only when net sales > 0)
− Losses                                     waste, spoiled, broken, count shortages × average cost
− Expenses, by category                      salaries, rent, bills, drawer expenses…
− Card fees                                  the fee saved on each card payment
= Net profit

Out of every 100 sold:  cost of what was sold · losses · expenses · profit   (adds up to 100)
```

**Never profit:** stock coming in (opening balances, count surplus) is shown only as information ("Stock added by counts…, not profit").

**Why purchases are not subtracted:** a purchase turns money into stock. That stock becomes cost only when it is sold or lost. Subtracting the purchase as well would count it twice. The report shows the stock bought in the period as information. Paying a supplier later does not change profit either.

**A refunded order keeps its cost**, unless its unused items are returned to stock.

**Old orders without a cost** (sold before costs existed, D20): cost, gross profit, margin and net profit show **"Can't calculate"** for that period, and are never counted as 0. New sales always have a cost. "Recalculate cost" was removed (Sprint 5 P8); orders it marked as an estimate keep the mark.

**Other places costs appear**
- **Products screen:** cost per serving and margin for each size, at today's average cost, and **each linked option**: its extra cost, extra price and the margin with it.
- **Ingredients screen:** stock and average cost.
- **Stock report:** value of each ingredient (balance × average cost) and the total stock value.

---

## 10. Reports

**Common rules**
- **Admin only.** Built from saved records only.
- **Dates use the café's local day:** sales and their payments (and card fees) → the day of the sale; refunds → the day of the refund; expenses and supplier payments → the day paid; purchases → the day **posted**; stock → the day of the movement. A past day never changes when something happens later.

| Report | What it answers |
|---|---|
| **Money in & out** | Every pound in and out, by cash / card / transfer. In: sales. Out: refunds, drawer expenses, other expenses, drawer purchases, other purchases, supplier payments (drawer / other), card fees. Then the net. The cash-drawer section shows cash put in / taken out (not in or out), gaps between shifts and over/short. |
| **Profit** | Section 9. |
| **Sales** | Number of orders, gross, discounts, tax, collected, refunds, net. |
| **Payments** | Cash and card: collected, refunded, net. |
| **Top products** | Per size: sold on the sale day, refunded on the refund day, and net. At most 100 rows. |
| **Stock** | Balance, low / negative, used in the period (optionally by one cashier or one shift), average cost, value, total stock value. |
| **Purchases & expenses** | Money paid for purchases (now or by supplier payments), general expenses, from the drawer vs external, by category. |
| **Shifts** | Per shift: opening, expected, counted, difference, cash in / out, gap from the previous close. |

The Dashboard also shows **what we owe suppliers** and **ingredients without a price**.

---

## 11. Safety nets (why the numbers can be trusted)

- **One step:** a sale, refund, purchase post, supplier payment, return to stock, void or shift close is saved completely or not at all.
- **Safe retries:** repeating a request because of a slow network never doubles a sale, refund, purchase post, supplier payment or cash entry.
- **Locks:** two people cannot change the same stock, shift, purchase or invoice number at the same moment; two payments can never pay more than is owed.
- **Old records stay as they were:** orders keep their prices, recipe, cost and card fee; a closed shift keeps its numbers; stock movements and the audit log can't be edited.
- **The tests:** 714 backend tests, 29 unit tests and 48 browser tests. A **whole day** test checks every pound and gram across the shift, the reports and the stock; a stock-value test checks start + purchases − cost of sales − losses + stock added = end.

---

## 12. Decisions taken (Sprint 5, owner 2026-11-17)

| # | Question | Decision |
|---|---|---|
| L1 | The typed ingredient cost | Removed; the cost is the average from purchases and opening balances |
| L2 / Q-A | Stock added by hand / count surplus | Never profit; "add quantity" removed |
| L3 | The whole profit cycle | Nothing enters without a known cost and source (sections 3, 9) |
| L4 | Cost per unit | Typed as quantity + total paid; the system computes it |
| P1 | Shared drawer | Each barista has their own drawer (D7 unchanged) |
| P2 / P3 | Changes or opening stock with no cost | Not possible any more: every movement has a cost |
| P4 | Buying on credit | Yes: supplier balance and partial payments |
| Q-B | Cups and lids | Ingredients in each size's recipe |
| Q-C | Card fees | A % in Settings, saved on each card payment |
| Q-E | Stock that appears later | Opening balance with its value and a reason |
| P6 | Option costs on the Products screen | Shown |
| P7 | Return to stock after a refund | Admin button |
| P8 | Recalculate cost | Removed |
| P9 | Purchase date | The posting day |
