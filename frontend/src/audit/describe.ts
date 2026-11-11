// Readable audit log (owner, 2026-11-11): every event becomes a translated sentence and a list of
// labelled details. No JSON, no technical names, no bare ids (the API resolves them in meta.names).
import type { TFunction } from "i18next";
import type { AuditEvent } from "../api/types";
import { paperLabel, type PaperWidth } from "../api/types";
import { formatMoney } from "../i18n/format";

export type Names = Record<string, string>;
export interface Ctx { t: TFunction; currency: string; names: Names }
export interface Detail { label: string; value?: string; before?: string; after?: string }

/** i18n keys cannot contain "." (it is the nesting separator). */
export const actionKey = (action: string) => action.replace(/\./g, "_");
export const entityKey = (type: string) => type.replace(/\./g, "_");

export const AREAS = ["sales", "shifts", "stock", "menu", "purchases", "expenses", "admin"] as const;
export type Area = (typeof AREAS)[number];
const AREA_OF: Record<string, Area> = {
  order: "sales", refund: "sales", shift: "shifts", stock: "stock", ingredient: "stock",
  category: "menu", product: "menu", variant: "menu", recipe: "menu", modifier_group: "menu", modifier_option: "menu",
  purchase: "purchases", supplier: "purchases", expense: "expenses", user: "admin", settings: "admin",
};
export const areaOf = (action: string): Area => AREA_OF[action.split(".")[0]] ?? "admin";

const MONEY = new Set(["total", "total_amount", "amount", "opening_cash", "expected_cash", "actual_cash", "difference", "price", "price_delta", "cash_sales", "card_sales", "cash_refunds", "card_refunds", "drawer_expenses"]);
const ID_KEYS = new Set(["shift_id", "order_id", "original_cashier_id", "owner_id", "expense_id", "ingredient_id", "category_id", "variant_id", "group_id", "supplier_id"]);
// Shown in the sentence or as their own section, not repeated as plain rows.
const SKIP = new Set(["changes", "before", "after", "totals", "payments", "lines", "items_detail"]);

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || v === "None";

/** One value, made readable: money, yes/no, names for ids, translated choices. */
export function fmt(key: string, v: unknown, c: Ctx): string {
  const { t } = c;
  if (isEmpty(v)) return "—";
  if (v === true || v === "True") return t("audit.yes");
  if (v === false || v === "False") return t("audit.no");
  const s = String(v);
  if (ID_KEYS.has(key)) return c.names[s] ?? t("audit.deleted");
  if (MONEY.has(key)) return formatMoney(s, c.currency);
  switch (key) {
    case "role": return t(`roles.${s}`, { defaultValue: s });
    case "source": return t(`expenses.sources.${s}`, { defaultValue: s });
    case "payment_method":
    case "method": return t(`expenses.methods.${s}`, { defaultValue: s });
    case "category": return t(`expenses.categories.${s}`, { defaultValue: s });
    case "type": return t(`audit.values.${s}`, { defaultValue: s });
    case "mode": return t(`modifiers.modes.${s}`, { defaultValue: s });
    case "base_unit": return t(`units.${s}`, { defaultValue: s });
    case "preferred_language":
    case "default_language": return s === "ar" ? "العربية" : "English";
    case "receipt_paper_width": return paperLabel(s as PaperWidth);
    case "tax_rate": return `${s}%`;
    case "fields": return (Array.isArray(v) ? v : [v]).map((f) => label(String(f), c)).join(c.t("audit.listSep"));
    default: return s;
  }
}

export const label = (key: string, c: Ctx) => c.t(`audit.fields.${key}`, { defaultValue: key.replace(/_/g, " ") });

const methods = (rows: unknown, c: Ctx) =>
  Array.isArray(rows) ? rows.map((p: { method: string; amount: string }) => `${fmt("method", p.method, c)} ${formatMoney(p.amount, c.currency)}`).join(" · ") : "";

/** "Price: 80.00 → 85.00; Active: Yes → No" (first few, for the one-line sentence). */
function changeText(changes: Record<string, { before: unknown; after: unknown }> | undefined, c: Ctx, max = 3) {
  if (!changes) return "";
  const parts = Object.entries(changes).map(([k, v]) => `${label(k, c)}: ${fmt(k, v.before, c)} ${c.t("audit.arrow")} ${fmt(k, v.after, c)}`);
  return parts.slice(0, max).join(c.t("audit.listSep")) + (parts.length > max ? ` ${c.t("audit.more", { count: parts.length - max })}` : "");
}

type Line = { ingredient_name?: string; base_qty?: string; unit?: string };
const recipeText = (lines: unknown, c: Ctx) =>
  Array.isArray(lines) && lines.length ? (lines as Line[]).map((l) => `${l.ingredient_name} ${l.base_qty}${l.unit ? ` ${c.t(`units.${l.unit}`)}` : ""}`).join(c.t("audit.listSep")) : c.t("audit.none");
const groupsText = (links: unknown, c: Ctx) =>
  Array.isArray(links) && links.length ? (links as { group_id: string }[]).map((l) => c.names[l.group_id] ?? c.t("audit.deleted")).join(c.t("audit.listSep")) : c.t("audit.none");

/** The record's own name, e.g. "POS-0000012" or "Iced Latte (Large)". */
function recordName(e: AuditEvent, c: Ctx) {
  const s = e.summary as Record<string, unknown>;
  const after = (s.after ?? {}) as Record<string, unknown>;
  return e.entity_label ?? (s.invoice_no as string) ?? (after.name as string) ?? (after.label as string) ?? (s.name as string) ?? (s.username as string) ?? c.t("audit.deleted");
}

/** The one-line sentence for the table. */
export function sentence(e: AuditEvent, c: Ctx): string {
  const s = e.summary as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const m = (k: string) => fmt(k, s[k], c);
  const name = recordName(e, c);
  const vars: Record<string, string | number> = { name };
  switch (e.action) {
    case "order.created": Object.assign(vars, { invoice: s.invoice_no, total: m("total"), payments: methods(s.payments, c) || c.t("audit.noPayment") }); break;
    case "refund.created": Object.assign(vars, { invoice: s.invoice_no, amount: m("total_amount"), reason: s.reason }); break;
    case "shift.opened": vars.cash = m("opening_cash"); break;
    case "shift.closed": Object.assign(vars, { owner: m("owner_id"), expected: m("expected_cash"), actual: m("actual_cash"), difference: m("difference") }); break;
    case "stock.adjusted": Object.assign(vars, { ingredient: m("ingredient_id"), delta: s.qty_delta, after: s.balance_after, reason: s.reason }); break;
    case "stock.counted": Object.assign(vars, { ingredient: m("ingredient_id"), counted: s.counted_qty, delta: s.qty_delta }); break;
    case "stock.opening_balance": Object.assign(vars, { ingredient: m("ingredient_id"), qty: s.qty }); break;
    case "recipe.replaced": vars.lines = recipeText(s.after, c); break;
    case "product.modifier_groups_replaced": vars.groups = groupsText(s.after, c); break;
    case "modifier_option.created":
    case "modifier_option.updated": vars.group = s.group ?? ""; vars.name = (s.after?.label as string) ?? name; vars.changes = optionChanges(s, c).slice(0, 3).map((d) => `${d.label}: ${d.before} ${c.t("audit.arrow")} ${d.after}`).join(c.t("audit.listSep")); break;
    case "purchase.created":
    case "purchase.updated":
    case "purchase.deleted":
    case "purchase.posted": Object.assign(vars, { total: m("total"), items: s.items ?? "—", source: m("source") }); break;
    case "expense.created":
    case "expense.voided": Object.assign(vars, { description: s.description, amount: m("amount"), source: m("source"), reason: s.reason ?? "" }); break;
    case "user.created": vars.role = m("role"); vars.name = s.username ?? name; break;
    default: vars.changes = changeText(s.changes, c);
  }
  return c.t(`audit.sentences.${actionKey(e.action)}`, { ...vars, defaultValue: "" });
}

/** Before/after of a modifier option snapshot, field by field. */
function optionChanges(s: Record<string, any>, c: Ctx): Detail[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const before = s.before ?? {}, after = s.after ?? {};
  const out: Detail[] = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[k], a = after[k];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    if (k === "variant_prices") out.push({ label: label(k, c), before: pricesText(b, c), after: pricesText(a, c) });
    else if (k === "effects") out.push({ label: label(k, c), before: effectsText(b, c), after: effectsText(a, c) });
    else out.push({ label: label(k, c), before: fmt(k, b, c), after: fmt(k, a, c) });
  }
  return out;
}
const pricesText = (rows: unknown, c: Ctx) =>
  Array.isArray(rows) && rows.length ? rows.map((p: { variant_id: string; price_delta: string }) => `${c.names[p.variant_id] ?? c.t("audit.deleted")} ${formatMoney(p.price_delta, c.currency)}`).join(c.t("audit.listSep")) : c.t("audit.none");
const effectsText = (rows: unknown, c: Ctx) =>
  Array.isArray(rows) && rows.length ? rows.map((e: { variant_id: string | null; ingredient_id: string; base_qty: string }) => `${c.names[e.ingredient_id] ?? c.t("audit.deleted")} ${e.base_qty} (${e.variant_id ? c.names[e.variant_id] ?? c.t("audit.deleted") : c.t("modifiers.allSizes")})`).join(c.t("audit.listSep")) : c.t("audit.none");

/** The labelled rows shown when a row is opened. */
export function details(e: AuditEvent, c: Ctx): Detail[] {
  const s = e.summary as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: Detail[] = [{ label: c.t("audit.record"), value: `${c.t(`audit.entities.${entityKey(e.entity_type)}`, { defaultValue: "" })} ${recordName(e, c)}`.trim() }];
  if (e.action.startsWith("modifier_option.")) {
    if (s.group) out.push({ label: label("group", c), value: String(s.group) });
    if (e.action.endsWith(".created")) for (const [k, v] of Object.entries(s.after ?? {})) {
      out.push({ label: label(k, c), value: k === "variant_prices" ? pricesText(v, c) : k === "effects" ? effectsText(v, c) : fmt(k, v, c) });
    }
    else out.push(...optionChanges(s, c));
    return out;
  }
  if (e.action === "recipe.replaced") return [...out, { label: label("recipe", c), before: recipeText(s.before, c), after: recipeText(s.after, c) }];
  if (e.action === "product.modifier_groups_replaced") return [...out, { label: label("modifier_groups", c), before: groupsText(s.before, c), after: groupsText(s.after, c) }];
  for (const [k, v] of Object.entries(s)) {
    if (SKIP.has(k) || (k === "invoice_no" && e.entity_label === v)) continue;
    out.push({ label: label(k, c), value: fmt(k, v, c) });
  }
  if (s.payments) out.push({ label: label("payments", c), value: methods(s.payments, c) || c.t("audit.noPayment") });
  if (s.lines) out.push({ label: label("lines", c), value: methods(s.lines, c) });
  for (const [k, v] of Object.entries((s.after ?? {}) as Record<string, unknown>)) out.push({ label: label(k, c), value: fmt(k, v, c) });
  for (const [k, v] of Object.entries((s.changes ?? {}) as Record<string, { before: unknown; after: unknown }>)) {
    out.push({ label: label(k, c), before: fmt(k, v.before, c), after: fmt(k, v.after, c) });
  }
  for (const [k, v] of Object.entries((s.totals ?? {}) as Record<string, unknown>)) out.push({ label: label(k, c), value: fmt(k, v, c) });
  return out;
}
