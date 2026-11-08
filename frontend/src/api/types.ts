export type Role = "admin" | "barista";
export interface User { id: string; username: string; display_name: string; role: Role; is_active: boolean; preferred_language: "en" | "ar"; }
export interface Settings {
  currency: string; timezone: string; default_language: "en" | "ar"; business_name: string;
  receipt_header: string; receipt_footer: string; receipt_paper_width: "58mm" | "80mm" | "a4";
  tax_enabled: boolean; tax_rate: string; prices_include_tax: boolean; tax_label: string;
  tax_registration_number: string; invoice_prefix?: string;
}
export interface Me { user: User; organization: { id: string; name: string }; settings: Settings; }
export interface Category { id: string; name: string; sort_order: number; is_active: boolean; }
export interface Variant { id: string; label: string; sku: string | null; price: string; sort_order: number; is_active: boolean; }
export interface Product { id: string; category_id: string; name: string; description: string; sort_order: number; is_active: boolean; variants: Variant[]; modifier_groups: { group_id: string; name: string; sort_order: number }[]; }
export type Unit = "g" | "ml" | "pcs";
export interface Ingredient { id: string; name: string; base_unit: Unit; low_stock_threshold: string | null; reference_unit_cost: string | null; is_active: boolean; }
export interface Balance { ingredient_id: string; ingredient_name: string; base_unit: Unit; is_active: boolean; qty: string; low_stock_threshold: string | null; is_low: boolean; is_negative: boolean; }
export interface Movement { id: string; ingredient_id: string; ingredient_name: string; base_unit: Unit; qty_delta: string; movement_type: string; source_type: string; balance_after: string; created_by_username: string; occurred_at: string; }
