# Q6 — API responses that differ from the spec

Written 2026-11-11 for the owner's decision. Source: Sprint 3 independent audit, items **L1** and **L4**. Status: **decided by the owner (2026-11-11): 1B, 2A, 3A, 4A** — done in Sprint 4.

For each item: what the spec says, what the code does now, who uses it, and the options. "Spec" means `docs/PROJECT_SPEC.md`.

---

## Item 1 — Refund response (`POST /orders/{id}/refunds`)

**Spec §9.4:**
```json
{"data":{"refund_id":"…","order_status":"refunded","total_amount":"115.00",
 "lines":[{"method":"cash","amount":"55.00"},
          {"method":"card","amount":"60.00","external_reference":"rf-778"}],
 "inventory_restored":false}}
```

**Code now** (`backend/apps/sales/refunds.py`):
```json
{"data":{"refund_id":"…","order_id":"…","invoice_no":"POS-0000012","status":"refunded",
 "total_amount":"115.00",
 "lines":[{"method":"cash","amount":"55.00","external_reference":""},
          {"method":"card","amount":"60.00","external_reference":"rf-778"}],
 "shift_id":"…","inventory_restored":false}}
```

| Field | Spec | Code | Note |
|---|---|---|---|
| order status | `order_status` | `status` | **Renamed** — the only real difference. |
| `order_id`, `invoice_no` | — | added | Useful for the screen and the audit. |
| `shift_id` | — | added | The shift the refund was recorded on (the refunding user's). |
| `external_reference` on a cash line | absent | `""` | Every line has the same fields. |

**Who uses it:** the refund dialog only checks that the call succeeded, then reloads the order. The order page and the receipt read the refund from the order detail, not from this response.

**Options:**
- **1A (recommended):** keep the code; update spec §9.4 to the code's shape.
- **1B:** keep the code and *also* send `order_status` (same value as `status`). Matches the spec without breaking anything. Small change + one test.
- **1C:** rename `status` → `order_status` and remove the extras. Changes the API for no gain.

## Item 2 — Shift close response (`POST /shifts/{id}/close`)

**Spec §9.4** (flat):
```json
{"data":{"status":"closed","opening_cash":"300.00","cash_sales":"1250.00","cash_refunds":"50.00",
 "drawer_expenses":"200.00","expected_cash":"1300.00","actual_cash":"1290.00","difference":"-10.00"}}
```

**Code now** (`backend/apps/shifts/selectors.py::shift_payload`) — the same object as `GET /shifts/current` and `GET /shifts/{id}`:
```json
{"data":{"id":"…","status":"closed","opening_cash":"300.00",
 "opened_at":"…","closed_at":"…","closed_by":{"id":"…","display_name":"…"},
 "user":{"id":"…","display_name":"…"},"register":"Main",
 "expected_cash":"1300.00","actual_cash":"1290.00","difference":"-10.00","close_note":"End of shift",
 "totals":{"cash_sales":"1250.00","card_sales":"…","cash_refunds":"50.00","card_refunds":"…",
           "drawer_expenses":"200.00","orders_count":42,"expected_cash":"1300.00"}}}
```

| Field | Spec | Code |
|---|---|---|
| `status`, `opening_cash`, `expected_cash`, `actual_cash`, `difference` | top level | top level (same) |
| `cash_sales`, `cash_refunds`, `drawer_expenses` | top level | **inside `totals`** |
| card sales/refunds, orders count, who closed, when, note, user, register | — | added |

For a closed shift, `totals` is the snapshot frozen at close; for an open shift it is computed live.

**Who uses it:** the Shift screen, the close dialog and the printed shift report all read `totals`. One shape for open, closed and listed shifts keeps the screens simple.

**Options:**
- **2A (recommended):** keep the code; update spec §9.4 to the nested shape.
- **2B:** keep the code and *also* copy `cash_sales`, `cash_refunds`, `drawer_expenses` to the top level of the close response only. Matches the spec, but the same numbers appear twice.
- **2C:** flatten the close response as in the spec. The close response then differs from every other shift response, and the screens must change.

## Item 3 — `GET /reports/purchases-expenses` ignores `cashier_id` and `shift_id`

**Spec §8.13:** all reports take `cashier_id` and `shift_id` "where meaningful".

**Code now:** the report checks both values are valid ids (400 if not) but **does not filter** by them. It always covers all posted expenses in the date range.

**Why:** only drawer expenses have a shift and a payer. Purchases and external expenses have no shift, so a shift filter would silently drop them from the purchase totals.

**Options:**
- **3A (recommended):** keep; write in spec §8.13 that this report has no cashier/shift filter (and make it return 400 if they are sent, so nobody thinks they work).
- **3B:** filter: with `shift_id`, only that shift's drawer expenses and drawer purchases; with `cashier_id`, only expenses created by that user. External expenses are then left out of the totals.

## Item 4 — `GET /reports/top-products` returns at most 100 rows

**Spec §8.13:** no limit.

**Code now:** the top 100 sizes by quantity or revenue (`backend/apps/reports/services.py`). The café has about 20 products, so the limit is never reached.

**Options:**
- **4A (recommended):** keep the 100 limit; write it in spec §8.13 and return `meta.truncated: true` when rows were cut.
- **4B:** remove the limit (return all rows).

---

## Your answer
Reply with one letter per item, for example: `1B, 2A, 3A, 4A`. I then update the spec (and the code, if needed) as a Sprint 4 task.
