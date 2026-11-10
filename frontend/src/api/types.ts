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
}
export interface Me { user: User; organization: { id: string; name: string }; settings: Settings; }
export interface Category { id: string; name: string; sort_order: number; is_active: boolean; }
export interface Variant { id: string; label: string; sku: string | null; price: string; sort_order: number; is_active: boolean; }
export interface Product { id: string; category_id: string; name: string; description: string; sort_order: number; is_active: boolean; variants: Variant[]; modifier_groups: LinkedGroup[]; }
export interface VariantPrice { variant_id: string; price_delta: string; }
export interface OptionEffect { variant_id: string | null; ingredient_id: string; ingredient_name?: string; unit?: Unit; base_qty: string; waste_pct: string; }
export interface ModifierOption { id: string; label: string; price_delta: string; sort_order: number; is_active: boolean; variant_prices: VariantPrice[]; effects?: OptionEffect[]; }
export interface LinkedGroup { group_id: string; name: string; sort_order: number; mode: "add" | "replace"; min_select: number; max_select: number; is_active: boolean; options: ModifierOption[]; }
export interface ModifierGroup { id: string; name: string; mode: "add" | "replace"; replacement_slot?: string | null; min_select: number; max_select: number; sort_order: number; is_active: boolean; options: ModifierOption[]; slot_warnings?: { product_name: string; variant_label: string }[]; }
export interface RecipeLine { ingredient_id: string; ingredient_name?: string; unit?: Unit; base_qty: string; waste_pct: string; slot_key: string | null; }
export interface RecipeWarning { code: string; group_name: string; replacement_slot: string; }
export interface Recipe { variant_id: string; lines: RecipeLine[]; warnings: RecipeWarning[]; updated_at: string; }
export interface ShiftTotals { cash_sales: string; card_sales: string; cash_refunds: string; card_refunds: string; drawer_expenses: string; orders_count: number; expected_cash: string; }
export interface Shift { id: string; status: "open" | "closed"; opening_cash: string; opened_at: string; user: { id: string; display_name: string }; register: string; totals: ShiftTotals; }
export interface StockWarning { ingredient_id: string; ingredient_name: string; unit: Unit; available: string; required: string; projected_balance: string; }
export interface QuoteItem { variant_id: string; product_name: string; variant_label: string; quantity: number; unit_price: string; unit_discount: string; line_total: string; modifiers: { option_id: string; label: string; price_delta: string }[]; }
export interface Quote { subtotal: string; discount_total: string; tax_total: string; total: string; tax: { enabled: boolean; rate: string; inclusive: boolean; label: string }; items: QuoteItem[]; stock_warnings: StockWarning[]; }
export interface PaymentRow { method: "cash" | "card"; amount: string; cash_tendered?: string; change_given?: string; external_reference?: string; }
export interface CheckoutResult { order_id: string; invoice_no: string; status: string; subtotal: string; discount_total: string; tax_total: string; total: string; payments: PaymentRow[]; change_due: string; receipt_url: string; stock_warnings: StockWarning[]; }
export interface OrderSummary { id: string; invoice_no: string; status: "paid" | "refunded"; total: string; created_at: string; cashier: { id: string; display_name: string }; items_count: number; payment_methods: string[]; }
export interface OrderDetail extends OrderSummary { shift_id: string; subtotal: string; discount_total: string; tax_total: string; tax: { enabled: boolean; rate: string; inclusive: boolean; label: string }; note: string; items: { id: string; product_name: string; variant_label: string; quantity: number; unit_price: string; line_total: string; modifiers: { option_label: string; price_delta: string }[] }[]; payments: PaymentRow[]; refund: null; }
export interface Receipt { business: { name: string; header: string; footer: string; tax_registration_number: string }; invoice_no: string; status: string; created_at: string; timezone: string; cashier: string; items: { name: string; variant: string; quantity: number; modifiers: string[]; unit_price: string; line_total: string }[]; subtotal: string; discount_total: string; tax: { enabled: boolean; label: string; rate: string; inclusive: boolean; amount: string }; total: string; payments: PaymentRow[]; refund: null; paper_width: PaperWidth; currency: string; }
export type Unit = "g" | "ml" | "pcs";
export interface Ingredient { id: string; name: string; base_unit: Unit; low_stock_threshold: string | null; reference_unit_cost: string | null; is_active: boolean; }
export interface Balance { ingredient_id: string; ingredient_name: string; base_unit: Unit; is_active: boolean; qty: string; low_stock_threshold: string | null; is_low: boolean; is_negative: boolean; }
export interface Movement { id: string; ingredient_id: string; ingredient_name: string; base_unit: Unit; qty_delta: string; movement_type: string; source_type: string; balance_after: string; created_by_username: string; occurred_at: string; }
