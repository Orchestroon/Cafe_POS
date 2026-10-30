# Drip Café ERP — Operations, Connected.
**Specialized Specialty Coffee Operations & Barista POS (Cairo, Egypt)**

A high-fidelity, client-ready MVP built directly from the official Figma designs. This system connects fast front-of-house sales with automated back-of-house inventory, recipe ingredient deductions, multi-warehouse transfers, supplier receiving, and shift reconciliation.

---

## 🚀 Quick Start with Docker Compose

Run the application locally with a single command:

```bash
cd drip-cafe-erp
docker compose up --build
```

Then open your browser at:
👉 **[http://localhost:8080](http://localhost:8080)**

To stop the container:
```bash
docker compose down
```

---

## ⚡ Running Locally Without Docker

You can run the app with any static server or Node.js:

```bash
cd drip-cafe-erp
npm start
# or
npx serve . -l 8080
# or with Python
python3 -m http.server 8080
```

---

## 🌟 Figma Insights Translated into MVP

| Figma Screen | Operational Insight & Business Need | MVP Feature Implemented |
| :--- | :--- | :--- |
| **1. Operations Overview** | General manager needs a single glass pane for real-time sales (EGP 8,450), drawer float, critical low stock alerts, incoming supplier deliveries, and outside events. | Interactive dashboard with live metrics, quick links to POS/transfers, real-time activity log, and upcoming outside event preparation. |
| **2. Barista POS** | Ultra-fast order entry with order types (Dine-in, Takeaway, Outside Event), modifier options (Oat milk +20 EGP, Double shot +20 EGP), and immediate stock validation. | Responsive grid catalog, customizer modal showing per-cup recipe impact (e.g. 18g beans + 160ml milk), split cash/card totals, outside event attribution, and instant cart reconciliation. |
| **3. Outside Events & Catering** | The client manages outside pop-ups, mobile espresso carts, corporate catering, and tasting cuppings. Stock must be reserved and sales attributed to the event. | Dedicated Outside Events management screen with "+ Plan outside event" modal, mobile stock kit reservation, guest tracking, and 1-click "Open Event POS" linking. |
| **4. Cashier Sign-In & Session** | Cashiers must open sessions with an explicit opening cash float (e.g. EGP 500) before sales unlock. Shifts are tied to named baristas (Omar Nabil). | 3-step session wizard (Sign-in → Open Session & Float → Active POS), preventing orphan transactions. |
| **5. Session Summary & Close** | Shift-end cash drawer reconciliation must automatically contrast expected drawer cash (`Opening float + Cash sales`) against counted cash with a clear variance badge. | Interactive closing calculator (`EGP 0.00 Balanced`), warning on open orders (#1042), and secure session sealing. |
| **6. Inventory & Warehouses** | **Multi-Warehouse Storage Model**: Client manages multiple warehouses (Bar Stock, Dry Store, Cold Store, mobile event carts, off-site depots). | "+ New warehouse" creation modal, dynamic multi-warehouse grid, reserve stock isolation (POS only touches Bar stock), and cross-warehouse transfer engine. |
| **7. Products & Recipes** | Products are linked to bill-of-materials (BOM) per serving. Ingredient quantities (e.g. 15g beans + 0.1L milk) scale dynamically. | Interactive Recipe Builder with per-serving cost, unit conversions (g, kg, ml, L, pcs), and a live consumption preview. |
| **8. Sales Invoices & Rectification** | Baristas occasionally enter wrong drinks or quantities by mistake. Managers need a controlled way to modify items or void invoices with automatic raw stock reversals. | Searchable invoice ledger with "+ Rectify / Void mistake" flow: modify items, change tender, or void with 100% automated recipe ingredient return to Bar stock and drawer adjustment. |
| **9. Suppliers & Receiving** | Fast onboarding for coffee roasters, fresh dairy, bakeries, and packaging vendors, plus clear inspection paper trail. | "+ Add supplier" modal with delivery scheduling, receiving inspection checklist, and direct warehouse destination routing. |
| **10. Team & Permissions** | Clear separation of responsibilities: Owner (full control), Admin (inventory, receiving, reports), and Barista (POS & personal shift view). | Interactive role permission matrix with live permission toggles per role (Owner, Administrator, Barista). |
| **11. Admin Settings** | Localization for Cairo, Egypt: EGP currency, Africa/Cairo timezone, configurable invoice numbering (INV-), and hardware connectivity states. | Branch setup, fiscal sequence configuration, payment method toggles, and device integration status. |

---

## 🎯 5-Minute Client Demonstration Walkthrough (Getting Client Agreement)

Follow this structured script when demonstrating the MVP to your client:

1. **Outside Events & Pop-ups (1 min)**:
   - Click **Outside events** in the sidebar.
   - Show the planned events (Community Cupping, Cairo Tech Summit, Zamalek Pop-up).
   - Click **+ Plan outside event** to demonstrate how easily the client can set up an outside catering gig with an allocated mobile stock kit.
   - Click **Open Event POS ↗** on an event to show how the Barista POS instantly tags incoming orders directly to that event!

2. **Shift Kickoff & Morning POS (1 min)**:
   - On the **Barista POS**, show Session **S-0028** (Omar Nabil, **EGP 500.00** float).
   - Ring up an order, select oat milk / extra shot modifiers, and click **Charge EGP 250.00** (Cash). Show the instant receipt.

3. **Mistake Order Rectification & Stock Reversal (1 min)**:
   - Open **Sales invoices & payments**. Select the newly completed invoice.
   - Click **✏️ Rectify / Void mistake order**.
   - Show the client the two mistake resolution modes:
     - *Mode A: Modify items/tender* (if customer changed their mind or paid with Card instead of Cash).
     - *Mode B: Complete Void* (barista punched duplicate order).
   - Confirm a void with an audit reason and immediately show that **100% of recipe ingredients were restored back into Bar stock** and the session net sales was adjusted!

4. **Multi-Warehouse Expansion (1 min)**:
   - Go to **Inventory & warehouses**.
   - Point out that **Bar Stock** is isolated from reserve warehouses.
   - Click **+ New warehouse** to show the client how they can add unlimited storage facilities (e.g., *Zamalek Mobile Cart*, *6th October Central Store*).
   - Show how the new warehouse immediately appears in the warehouse grid and transfer selectors.

5. **Supplier Onboarding & Receiving (1 min)**:
   - Open **Suppliers & receiving**.
   - Click **+ Add supplier** to show the new interactive popup for registering partners (e.g., *Delta Dairy Co.* with delivery terms).
   - Inspect delivery **RCV-0028** from Nile Roasters and confirm receipt directly into Dry Store.

6. **Reset Anytime**:
   - Simply click `↺ Reset Data` in the top header at any point to restore all screens back to the pristine starting state!

---

## 🏗️ Architecture & Technology Stack

- **Frontend Core**: Semantic HTML5 and modular ES6 JavaScript.
- **Design System**: Vanilla CSS with bespoke design tokens matching the Figma color palette (`#191412` Warm Roasted Charcoal, `#b85834` Terracotta, and `#fbf9f5` Editorial Cream Canvas).
- **Typography**: Google Fonts pairing of **Newsreader** (editorial serif headlines) + **Plus Jakarta Sans** (clean grotesk UI) + **JetBrains Mono** (SKUs, timestamps, invoices).
- **State Management**: Reactive in-memory state engine persisting to `localStorage` with automated stock deduction algorithms and audit logging.
- **Production Container**: Nginx Alpine Linux container (`< 25MB` total image size) with Gzip compression and single-page routing.
