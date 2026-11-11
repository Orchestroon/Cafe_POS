# Sprint 4 report — Stabilization

Branch `sprint-4-stabilization` (from `main` `ba0674b`). **Status: finalized — approved by the owner (2026-11-11)** after the manual test of every item (including feedback round 1). Committed step by step, one commit per step, each pushed by the owner before the next. Plan: `docs/sprints/sprint-4-plan.md`.

## What was built

### Your items
| # | What you asked | What I did |
|---|---|---|
| **B1** | The open-shift popup must close with ✕ | ✕, Esc, Cancel or a click outside close it. No shift is opened. The POS stays visible but **locked**: products greyed, cart and Pay disabled. The shift bar shows "No open shift" and an **Open shift** button (F4) that brings the popup back. |
| **B2** | Keyboard shortcuts on the whole system | One list in `frontend/src/lib/shortcuts.ts`; press **?** anywhere to see it. Key hints on the main buttons (Pay F2, Open shift F4, New N, Enter). Details and the changes to the proposed keys are below. |
| **B3** | A size with no recipe sold without touching stock | New **"Track stock"** box per size (on by default). A tracked size with no recipe **cannot be sold**: the till greys it out ("No recipe — ask an Admin") and the server refuses it (`RECIPE_MISSING`, nothing written). Untick "Track stock" for a service item: it sells with no stock movement. A size cannot have both a recipe and "no tracking". "No recipe" badges on Products; a **"Sizes without a recipe"** card on the Overview. Existing sizes without a recipe are now blocked (your decision). |
| **R2** | Same rule for extras | New **"No stock effect"** box per option (e.g. "No ice"). A normal option with no ingredient cannot be sold (`INVALID_MODIFIER`, `no_effect`). "No ingredient" badges on Modifiers; counted on the Overview card. |
| **C2** | Show the last close when opening a shift | The open-shift popup shows "Your last shift closed on … with … counted" (your own last close, information only). |
| **Q6** | API vs spec (1B, 2A, 3A, 4A) | 1B: the refund response also sends `order_status`. 2A: spec updated to the nested shift `totals`. 3A: `purchases-expenses` returns 400 if `cashier_id`/`shift_id` is sent. 4A: `top-products` keeps 100 rows and says `meta.truncated`. |
| Arabic | Translate in this sprint | **All 494 texts translated** in `ar.json` for your review. Arabic plurals use their 6 forms. |

### Sprint 4 spec tasks
- **Audit log:** `GET /audit-events` (Admin, read-only, newest first, filters action / user / record type / record id / dates, café-local days, pages). New page **Admin → Audit log**: filters in the URL, click a row to see its details. **History** buttons on order, shift, purchase and product pages open the log filtered to that record.
- **Permission sweep:**
  - New test: every response a Barista can get (every shared route in the permission matrix, plus checkout, refund, quote, expense and close responses) is scanned for admin-only fields such as costs, recipes, effects, slots, invoice prefix, suppliers and passwords. **None found.**
  - The existing matrix already proves every admin route answers 403 to a Barista and changes nothing; `/audit-events` was added to it.
- **Performance:**
  - Query-count limits in pytest for quote, checkout, orders, order detail, receipt, products, modifier groups, shifts, reports and the audit log. Lists are proven not to grow with more rows.
  - No slow spot found. Measured on the seeded stack, 20 runs each:

  | | quote median / worst | checkout median / worst |
  |---|---|---|
  | 1 item (Large + Oat + Extra Shot) | 41 / 55 ms | 74 / 82 ms |
  | 5 lines | 44 / 55 ms | 101 / 117 ms |

  The target was under ~2 s.
- **Playwright E2E** (27 tests, isolated stack, own database): login (good / bad / barista); open shift (B1) → Large + Oat + Extra Shot → mixed 80 cash + 40 card → receipt; refund with reason (and second refund refused); purchase post (stock +12 000 ml, one expense); shift close (expected / counted / difference, then C2); Barista blocked from admin pages and APIs with no side effects; audit log; recipe guard (B3); keyboard flow.
- **Lost connection during checkout (AT-20):**
  - The server commits but the answer is lost → the same key is resent → **one** order.
  - A 503 from a proxy → the same key is resent → one order.
  - Offline → "Could not confirm the last sale", selling paused, nothing created → back online, Retry → one order.
- **Responsive QA:** POS, Orders, Shift and Receipt, on phone (375), tablet (768) and desktop (1280), in English and Arabic. Checked: no sideways page scroll, main action visible. 24 screenshots saved.
- **Print QA:** the receipt at 58 mm, 80 mm and A4 fits the printable width, shows the invoice number and total, hides the buttons, and shows REPRINT only on a reprint. PDFs saved.
- **i18n coverage:**
  - Lint rule `i18next/no-literal-string` fails on any text typed straight into a screen.
  - `npm run i18n:check` fails on missing or extra keys, empty Arabic, unknown keys used in code, or a missing `{{placeholder}}` in Arabic.
  - RTL smoke test: `dir="rtl"`, sidebar on the right, Arabic labels, no sideways scroll on 7 pages.
- **Vitest** (20 unit tests): checkout retry rules (H2), decimal maths (AT-03, pack helpers), cart (per-user storage, blocked storage), shortcuts (no browser keys, Arabic layout, typing guard).
- **CI:** the frontend job now also runs `i18n:check` and `npm test`; the backend job runs `spectacular --validate`; a new **`e2e` job** runs the Playwright suite and uploads screenshots, PDFs and traces.

### Bugs found and fixed along the way
| # | Bug | Fix | Test |
|---|---|---|---|
| F1 | `PUT /variants/{id}/recipe` with a line **without `waste_pct`** gave a 500 (the default stayed the text `"0.00"`). The UI always sends it, so it only hit API callers. Same pattern in option prices and effects. | Real decimal defaults. | `test_recipe_line_without_waste_pct_defaults_to_zero_not_500` |
| F2 | **Receipts were wider than the printable area**: 58 mm paper with 2 mm margins prints 54 mm, but the receipt was 58 mm; A4 was 190 mm for 186 mm. The printer would cut or shrink the edges. | Width = paper − margins, padding inside the width. | `10-print.spec.ts` |
| F3 | `test_admin_filters` failed between 22:00 and 24:00 UTC (00:00–02:00 Cairo): it built "today" in UTC. | Uses the café's local date. | the test itself |
| F4 | `REGISTER_NOT_CONFIGURED` and `INTERNAL_ERROR` had no screen message (the English server text showed even in Arabic). | Added in both languages. | `i18n:check` |
| F5 | The help texts "an empty recipe deducts nothing" and "an option with no rows changes nothing" became wrong with B3/R2. | Rewritten. | — |
| F6 | Nested popups: Esc could close more than the top one. | Each popup is its own shortcut layer; only the top one reacts. | `08-shortcuts.spec.ts` |

## Your feedback round 1 (2026-11-11) — done
| What you said | What I did |
|---|---|
| The audit screen is technical (JSON, codes) | Each line is now a **plain sentence**: When · Who · What happened · Details, e.g. "Refunded invoice POS-0000002 (65.00 EGP) · Reason: “Customer changed mind”". Click a line for **labelled details** (Reason, Sold by, Shift, Paid back…) and changes as **Before → After** (e.g. "Track stock: Yes → No"). The raw data is **removed** (your choice). Filters: **What happened** (grouped: Sales and refunds, Shifts, Stock, Products and menu, Purchases, Expenses, Users and settings), **Who**, dates; the technical "Record type / Record id" boxes are gone. "History" from a record shows "Showing the history of: POS-0000012" with **Show all**. |
| Actions and record types not translated in Arabic | All **35 actions**, 7 areas, 15 record types and 80 detail labels have English and Arabic texts. The API now sends readable **names** for every id (invoice, product and size, ingredient, user, shift, supplier…), read-only, so old records read well too. A new backend test fails if the code ever records an action with no English or Arabic text — it immediately caught two I had missed (supplier added / changed). |
| The Arabic text looks bad → font | The English font has no Arabic letters, so the browser used a random system font. Arabic mode now uses **Cairo** everywhere (also on Arabic receipts), with more line spacing so letters are not clipped. A browser test checks Cairo is really loaded. |

Checks after this round: **619 backend tests** pass (no skips), **29 E2E** pass (audit log in English and Arabic: no technical text anywhere, every action / area / label in Arabic), unit tests, i18n check (681 keys), lint, typecheck, build. New screenshots: `en-desktop-audit.png`, `ar-desktop-audit.png`, `ar-phone-audit.png`.
Small infra change: `docker-compose.yml` mounts `frontend/src/i18n` **read-only** into the backend container so that test also runs locally.

## Keyboard shortcuts (for your review)
| Where | Keys |
|---|---|
| Everywhere | `?` help · `Alt+P` POS · `Alt+O` Orders · `Alt+S` Shift · `Alt+H` Overview (Admin) · `/` search box · `Esc` close popup |
| POS | `F2` Pay · `F4` Open shift · `0` all categories · `1`–`9` category · arrows move between products, `Enter` opens one · `+` / `−` quantity of the last line · `Delete` remove the last line · `Ctrl+Backspace` clear cart (asks) |
| Product popup | `1`–`9` size · `Enter` add to cart (`Space` ticks the focused option) |
| Payment popup | `F8` Cash → Card → Mixed · `Enter` confirm |
| Lists / admin | `↑` `↓` rows (Orders, Audit log), `Enter` opens · `N` New · `Ctrl+P` print |
| Popups / forms | `Ctrl+Enter` save / confirm |

**Changed from the proposed table** (browser conflicts, found while building):
- **Alt+D → Alt+H.** Alt+D jumps to the Chrome address bar.
- **F5 / F6 / F7 → F8 cycles the payment method.** F5 reloads the page, F6 jumps to the address bar, F7 opens Chrome's caret-browsing prompt.
- **`0` was added for "All categories".**

## Test and check results (local, Docker)
| Check | Result |
|---|---|
| `ruff check`, `ruff format --check`, `makemigrations --check` | pass |
| `pytest` | **616 passed**, coverage 99% (571 at the end of Sprint 3) |
| `spectacular --validate --fail-on-warn` | clean |
| `typecheck`, `lint` (incl. the new i18n rule), `build` | pass |
| `npm run i18n:check` | pass: 494 keys, en/ar in sync |
| `npm test` (Vitest) | **20 passed** |
| Playwright E2E | **27 passed** (fresh stack), also passes when re-run on leftover data |

**Acceptance tests automated:** AT-02–AT-13 and AT-26 (pytest, Sprint 2); AT-14–AT-18 and AT-22 (pytest, Sprint 3; AT-14, 15, 16 and 18 also in the browser); AT-19 (matrix plus browser); **AT-20 (browser, 3 cases)**; AT-25 (cross-tenant tests, including `/audit-events`). Only AT-21 and AT-24 need you, and AT-23 is Sprint 5.

How to run the browser tests yourself:
```
docker compose -f docker-compose.e2e.yml run --rm e2e
docker compose -f docker-compose.e2e.yml down -v
```
The first command runs the tests (about 2 minutes, plus a few minutes the first time to download the images); the second removes the test stack. Your dev data is never touched.

## Deviations from the spec / plan
1. **Shortcut keys changed** from the proposed table (see above).
2. **i18n lint rule** checks visible JSX text, not attributes. The stricter mode flagged translation-key lists as false alarms. Checked by hand: the only literal attributes are `placeholder="milk"` (a slot example), `placeholder="POS-0000001"` (the invoice format) and the logo `alt="Growl Tech"`. Units (g / ml / pcs) are translated in the ingredient form; elsewhere they are shown as stored.
3. **`GET /audit-events` adds `meta.actions` and `meta.entity_types`** (the values that exist, for the filter dropdowns). Not in the spec; read-only.
4. **The "History" button** filters by the record itself. A refund is its own record (`sales.refund`), so an order's History shows `order.created`; the refund appears under the refund record or with the "refund.created" filter.
5. **The Overview "Sizes without a recipe" card** is computed in the browser from the product list (no new endpoint).
6. **The Barista product list** now includes `track_stock` and `has_recipe` per size, so the till can grey out unsellable sizes. These are flags, not costs or recipes.
7. **E2E runs against the Vite dev server**, not a production build. The production build and proxy come in Sprint 5.
8. **Your dev database:** any size you created without a recipe is now blocked at the till until you add a recipe or untick "Track stock" (your decision for B3).
9. **Spec updated** in the same change for every behavior above: D12, D18, §7.3, §7.4, §8.2, §8.10, §8.13, §9.2 (new `RECIPE_MISSING`, `REGISTER_NOT_CONFIGURED`), §9.3, §9.4, §10.1, §10.2.

## Known issues / open questions
- **`npm audit`: 12 moderate, 0 high or critical.**
  - 10 are in the ESLint tool chain: development only, never shipped.
  - 2 are in **react-router**: an open redirect through a backslash in a link, and an issue with server-side rendering, which we don't use. The app has no redirect taken from user input, so I see no way to exploit it today. The only fix is the **major upgrade v6 → v7**. **Do you want it in Sprint 5?**
- The **`stock` report** also ignores `cashier_id` / `shift_id` silently, the same as Q6 item 3, which you decided only for `purchases-expenses`. Should it also return 400?
- On a **phone, the Orders table** scrolls sideways inside its own box (the cashier column is partly hidden); the page itself does not. Look at `ar-phone-orders.png` / `en-phone-orders.png` and tell me if you want a card layout on phones.
- **Arabic** is machine-consistent but needs your review for wording (list below).
- S3 ("Adjust stock" link on refunded orders) is still waiting for you.
- `frontend/dist` is created by the build inside the container, so it is owned by root (git ignores it).

### Arabic terms to check
وردية (shift) · نقطة البيع (POS) · السلة (cart) · نقدي / بطاقة / مختلط (cash / card / mixed) · استرداد (refund) · الدرج / درج النقدية (cash drawer) · المكونات (ingredients — or الخامات?) · الإضافات (modifiers) · الوصفة (recipe) · الخانة (recipe slot) · الهالك (waste) · ترحيل / مُرحّلة (post / posted purchase) · مصروف ملغى (voided expense) · سجل التدقيق (audit log) · خزينة (register, in the error text) · جم / مل / قطعة (g / ml / pcs).

## Files to look at
- Screenshots: `frontend/e2e/artifacts/screens/<en|ar>-<phone|tablet|desktop>-<pos|orders|shift|receipt>.png`
- Receipt PDFs: `frontend/e2e/artifacts/print/receipt-58mm.pdf`, `receipt-80mm.pdf`, `receipt-a4.pdf`
- Full Playwright report: `frontend/e2e/artifacts/report/index.html`

## Owner manual test checklist
Start: `docker compose up -d --build --wait` (the backend applies the 2 new migrations itself; the frontend container picks up the new packages with `npm ci`). `docker compose exec backend python manage.py seed_demo` only if you want the demo data. App: http://localhost:5173. Logins `admin`, `barista1`, `barista2`, password `Demo-pass-123`.
- [ ] **B1:** as barista with no shift, open POS → close the popup with ✕ → products are greyed → "Open shift" on the bar → open with 300.00.
- [ ] **C2:** close that shift, go back to POS → the popup shows "Your last shift closed … with … counted".
- [ ] **B3:** as admin, add a size to a product without a recipe → red "No recipe" badge on Products and the Overview card → at the till that size is greyed out. Untick "Track stock" → it sells, and no stock movement appears. Tick it back and add a recipe → it sells and deducts.
- [ ] **R2:** as admin, add an option "Caramel" with no ingredient → "No ingredient" badge, and the popup asks you to add an effect or tick "No stock effect". Add "No ice" with "No stock effect" → it sells and deducts only the recipe.
- [ ] **B2:** press `?` and review the whole list. Try a full sale from the keyboard: `1` category, `↓` then `Enter`, `2` size, `Enter`, `F2`, `F8`, `Enter`.
- [ ] **Audit log:** Admin → Audit log. Lines read as sentences; filter "What happened → Refund", by a user and by dates; click a line to see the details (Before → After on a changed price). Open an order → History → "Show all". Switch to عربي: every action and detail is in Arabic. A Barista cannot open the page.
- [ ] **Arabic font:** switch to عربي and check the Cairo font on the menu, the till, a report and a printed receipt.
- [ ] **Arabic:** switch to عربي and read every screen; mark any wrong or unnatural wording (see the list above).
- [ ] Look at the screenshots and the 3 receipt PDFs. **Print a receipt again on your real printer** (58 or 80 mm): the receipt is now slightly narrower to fit inside the margins.
- [ ] On your real phone and tablet: a sale, Orders, Shift close.
- [ ] Optional: run the E2E suite yourself with the command above; it ends with "27 passed".
