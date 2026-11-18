export type Role = "admin" | "barista";
export const PAPER_WIDTHS = ["58mm", "76mm", "80mm", "112mm", "a4"] as const;
export type PaperWidth = (typeof PAPER_WIDTHS)[number];
export const paperLabel = (w: PaperWidth) => (w === "a4" ? "A4" : `${w.slice(0, -2)} mm`);
export interface User { id: string; username: string; display_name: string; role: Role; is_active: boolean; preferred_language: "en" | "ar"; }
export interface Settings {
  currency: string; timezone: string; default_language: "en" | "ar"; business_name: string;
  receipt_header: string; receipt_footer: string; receipt_paper_width: PaperWidth;
  tax_enabled: boolean; tax_rate: string; prices_include_tax: boolean; tax_label: string;
  tax_registration_number: string; invoice_prefix?: string;
  /** Admin only (Sprint 5 Q-C): the bank's commission on card sales, in %. */
  card_fee_pct?: string;
}
export interface Me { user: User; organization: { id: string; name: string }; settings: Settings; }
export interface Category { id: string; name: string; sort_order: number; is_active: boolean; }
export interface Variant { id: string; label: string; sku: string | null; price: string; sort_order: number; is_active: boolean; track_stock: boolean; has_recipe: boolean; }
/** B3: a size that must have a recipe but has none cannot be sold. */
export const needsRecipe = (v: Pick<Variant, "track_stock" | "has_recipe">) => v.track_stock && !v.has_recipe;
export interface Product { id: string; category_id: string; name: string; description: string; sort_order: number; is_active: boolean; variants: Variant[]; modifier_groups: LinkedGroup[]; }
export interface VariantPrice { variant_id: string; price_delta: string; }
export interface OptionEffect { variant_id: string | null; ingredient_id: string; ingredient_name?: string; unit?: Unit; base_qty: string; waste_pct: string; }
export interface ModifierOption { id: string; label: string; price_delta: string; sort_order: number; is_active: boolean; track_stock: boolean; variant_prices: VariantPrice[]; effects?: OptionEffect[]; }
export interface LinkedGroup { group_id: string; name: string; sort_order: number; mode: "add" | "replace"; min_select: number; max_select: number; is_active: boolean; options: ModifierOption[]; }
export interface ModifierGroup { id: string; name: string; mode: "add" | "replace"; replacement_slot?: string | null; min_select: number; max_select: number; sort_order: number; is_active: boolean; options: ModifierOption[]; slot_warnings?: { product_name: string; variant_label: string }[]; }
export interface RecipeLine { ingredient_id: string; ingredient_name?: string; unit?: Unit; base_qty: string; waste_pct: string; slot_key: string | null; }
export interface RecipeWarning { code: string; group_name: string; replacement_slot: string; }
export interface Recipe { variant_id: string; lines: RecipeLine[]; warnings: RecipeWarning[]; updated_at: string; }
/** GET/PUT /products/{id}/setup: the product, every size with its recipe (Admin). */
export interface ProductSetup extends Omit<Product, "variants"> { variants: (Variant & { recipe: Recipe })[]; }
/** cash_in/cash_out are missing on shifts closed before the money review (read them as 0.00). */
export interface ShiftTotals { cash_sales: string; card_sales: string; cash_refunds: string; card_refunds: string; drawer_expenses: string; cash_in?: string; cash_out?: string; orders_count: number; expected_cash: string; }
export interface CashMovement { id: string; shift_id: string; kind: "in" | "out"; amount: string; reason: string; status: "posted" | "voided"; created_at: string; created_by: Person; void_reason: string; voided_at: string | null; voided_by: Person | null; }
export interface ShiftGap { previous_shift_id: string; previous_closed_at: string; previous_actual_cash: string; difference: string; }
export interface Person { id: string; display_name: string; }
export interface Shift {
  id: string; status: "open" | "closed"; opening_cash: string; opened_at: string; closed_at: string | null; closed_by: Person | null;
  user: Person; register: string; expected_cash: string | null; actual_cash: string | null; difference: string | null; close_note: string; totals: ShiftTotals;
  cash_movements?: CashMovement[]; since_previous_close?: ShiftGap | null;
}
export interface LastClosed { id: string; closed_at: string; actual_cash: string; }
export interface AuditEvent { id: string; created_at: string; action: string; entity_type: string; entity_id: string; entity_label: string | null; actor: { id: string; username: string; display_name: string } | null; summary: Record<string, unknown>; }
export interface AuditMeta { page: number; page_size: number; total_count: number; actions: string[]; entity_types: string[]; names: Record<string, string>; }
export interface StockWarning { ingredient_id: string; ingredient_name: string; unit: Unit; available: string; required: string; projected_balance: string; }
export interface QuoteItem { variant_id: string; product_name: string; variant_label: string; quantity: number; unit_price: string; unit_discount: string; line_total: string; modifiers: { option_id: string; label: string; price_delta: string }[]; }
export interface Quote { subtotal: string; discount_total: string; tax_total: string; total: string; tax: { enabled: boolean; rate: string; inclusive: boolean; label: string }; items: QuoteItem[]; stock_warnings: StockWarning[]; }
export interface PaymentRow { method: "cash" | "card"; amount: string; cash_tendered?: string; change_given?: string; external_reference?: string; }
export interface CheckoutResult { order_id: string; invoice_no: string; status: string; subtotal: string; discount_total: string; tax_total: string; total: string; payments: PaymentRow[]; change_due: string; receipt_url: string; stock_warnings: StockWarning[]; }
export interface OrderSummary { id: string; invoice_no: string; status: "paid" | "refunded"; total: string; created_at: string; cashier: { id: string; display_name: string }; items_count: number; payment_methods: string[]; }
/** Sprint 5 P7 (Admin only): what was put back in stock after the refund. */
export interface StockReturnInfo { created_at: string; reason: string; total_value: string; created_by: string; }
export interface ConsumptionRow { ingredient_id: string; ingredient_name: string; unit: Unit; total_qty: string; unit_cost: string | null; }
export interface OrderDetail extends OrderSummary { stock_return?: StockReturnInfo | null; cost_total?: string | null; shift_id: string; subtotal: string; discount_total: string; tax_total: string; tax: { enabled: boolean; rate: string; inclusive: boolean; label: string }; note: string; items: { id: string; product_name: string; variant_label: string; quantity: number; unit_price: string; line_total: string; modifiers: { option_label: string; price_delta: string }[]; consumption?: ConsumptionRow[] }[]; payments: PaymentRow[]; refund: RefundInfo | null; }
export interface Receipt { business: { name: string; header: string; footer: string; tax_registration_number: string }; invoice_no: string; status: string; created_at: string; timezone: string; cashier: string; items: { name: string; variant: string; quantity: number; modifiers: string[]; unit_price: string; line_total: string }[]; subtotal: string; discount_total: string; tax: { enabled: boolean; label: string; rate: string; inclusive: boolean; amount: string }; total: string; payments: PaymentRow[]; refund: RefundInfo | null; paper_width: PaperWidth; currency: string; }
export type Unit = "g" | "ml" | "pcs";
/** stock_qty / avg_cost come from the stock balance (Sprint 5 L1): the cost is never typed. */
export interface Ingredient { id: string; name: string; base_unit: Unit; low_stock_threshold: string | null; stock_qty: string | null; avg_cost: string | null; is_active: boolean; }
/** unit_cost: weighted average cost per base unit; null = never stocked with a value. */
export interface Balance { ingredient_id: string; ingredient_name: string; base_unit: Unit; is_active: boolean; qty: string; low_stock_threshold: string | null; is_low: boolean; is_negative: boolean; unit_cost: string | null; }
export interface Movement { id: string; ingredient_id: string; ingredient_name: string; base_unit: Unit; qty_delta: string; movement_type: string; source_type: string; balance_after: string; created_by_username: string; occurred_at: string; }

export interface RefundLine { method: "cash" | "card"; amount: string; external_reference: string; }
export interface RefundInfo { id: string; created_at: string; actor: Person; reason: string; total_amount: string; shift_id: string | null; lines: RefundLine[]; inventory_restored: boolean; }
export interface RefundResult { refund_id: string; order_id: string; invoice_no: string; status: string; total_amount: string; lines: RefundLine[]; shift_id: string | null; inventory_restored: boolean; }
export const EXPENSE_CATEGORIES = ["salaries", "rent", "utilities", "maintenance", "supplies", "transport", "cleaning", "marketing", "taxes_fees", "card_fees", "other"] as const;
export type PayMethod = "cash" | "card" | "transfer";
export type PaySource = "cash_drawer" | "external";
export interface Expense {
  id: string; type: "general" | "purchase" | "supplier_payment"; category: string; description: string; amount: string; payment_method: PayMethod; source: PaySource;
  shift_id: string | null; purchase_id: string | null; paid_at: string; status: "posted" | "voided"; void_reason: string; voided_at: string | null; created_by: Person;
}
export interface Supplier { id: string; name: string; phone: string; notes: string; is_active: boolean; owed: string; }
/** Sprint 5 P4: money paid to a supplier for purchases bought on credit. */
export interface SupplierPayment {
  id: string; supplier: { id: string; name: string }; amount: string; source: PaySource; payment_method: PayMethod; note: string;
  status: "posted" | "voided"; paid_at: string; created_by: Person | null; void_reason: string; voided_at: string | null; voided_by: Person | null;
  lines: { purchase_id: string; supplier_invoice_no: string; purchased_on: string; amount: string }[];
}
export interface PurchaseItem {
  id?: string; ingredient_id: string; ingredient_name?: string; unit?: Unit; qty: string; unit_cost: string; line_total?: string;
  pack_label: string; pack_count: string | null; pack_size: string | null; pack_cost?: string | null;
}
export interface Purchase {
  id: string; supplier: { id: string; name: string } | null; supplier_invoice_no: string; purchased_on: string; status: "draft" | "posted" | "voided";
  payment_method: PayMethod; source: PaySource; notes: string; total: string; on_credit: boolean; amount_paid: string; owed: string; posted_at: string | null; posted_by: Person | null; created_by: Person | null; items: PurchaseItem[];
  void_reason: string; voided_at: string | null; voided_by: Person | null;
}
export interface ReportEnvelope<T> { data: T; meta: { range: { from: string; to: string; timezone: string } }; }
export interface SalesSummary { orders_count: number; gross_sales: string; discounts: string; tax: string; collected: string; refunds: string; net_sales: string; refunded_orders_count: number; }
export interface PaymentBreakdown { cash_collected: string; card_collected: string; cash_refunded: string; card_refunded: string; cash_net: string; card_net: string; }
export interface TopProducts { products: { variant_id: string; product_name_snapshot: string; variant_label_snapshot: string; qty_sold: number; qty_refunded: number; refunded_revenue: string; net_revenue: string }[]; }
export interface StockReport {
  ingredients: { ingredient_id: string; name: string; unit: Unit; balance: string; threshold: string | null; is_low: boolean; is_negative: boolean; consumed_qty_period: string; is_active: boolean; unit_cost: string | null; value: string | null }[];
  stock_value: string; without_cost_count: number;
}
export interface PurchasesExpenses { purchase_total: string; general_expenses_total: string; cash_drawer_total: string; external_total: string; breakdown: { category: string; total: string }[]; }
export interface ShiftsReport {
  shifts_count: number; open_count: number; closed_count: number; expected_cash_total: string; actual_cash_total: string; total_difference: string;
  cash_in_total: string; cash_out_total: string; gap_total: string;
  shifts: { id: string; user: Person; status: "open" | "closed"; opened_at: string; closed_at: string | null; opening_cash: string; expected: string | null; actual: string | null; difference: string | null; orders_count: number; cash_in: string; cash_out: string; previous_actual: string | null; gap: string | null }[];
}
export const MONEY_METHODS = ["cash", "card", "transfer"] as const;
export interface MoneyRow { key: string; direction: "in" | "out" | "net"; cash: string; card: string; transfer: string; total: string; }
export interface MoneyInOut {
  rows: MoneyRow[]; total_in: MoneyRow; total_out: MoneyRow; net: MoneyRow;
  drawer: { cash_in: string; cash_out: string; gap_total: string; closed_count: number; total_difference: string };
}
export interface ProfitReport {
  // cost, profit and margin are null when any order or stock change has no cost (never shown as 0)
  sales: string; refunds: string; net_sales: string; cost_of_sales: string | null; gross_profit: string | null; gross_margin_pct: string | null;
  returned_to_stock: string; stock_losses: string; general_expenses: string; card_fees: string; expenses_by_category: { category: string; amount: string }[];
  net_profit: string | null; per_100: { cost: string; losses: string; expenses: string; profit: string } | null;
  purchases_info: string; stock_added_info: string;
  orders_without_cost: number; sales_without_cost: string; adjustments_without_cost: number;
  estimated_orders: number; ingredients_without_cost: string[];
}
export const REPORT_NAMES = ["money-in-out", "profit", "sales-summary", "payment-breakdown", "top-products", "stock", "purchases-expenses", "shifts"] as const;
export type ReportName = (typeof REPORT_NAMES)[number];
