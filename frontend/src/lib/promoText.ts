// Plain-language summaries of a promotion (list rows and the form preview). Pure: the caller
// passes `t` and the name lookups, so it is the same text in English and Arabic.
import type { TFunction } from "i18next";
import type { ComboSlot, Promotion } from "../api/types";

export interface Names { variant: (id: string) => string; category: (id: string) => string; money: (v: string) => string; locale: string }
type Rules = Pick<Promotion, "kind" | "scope" | "discount_type" | "discount_value" | "variant_ids" | "category_ids" | "combo_price" | "slots" | "starts_on" | "ends_on" | "days_of_week" | "window_start" | "window_end">;

const list = (t: TFunction, names: string[]) => (names.length > 3 ? `${names.slice(0, 3).join(t("audit.listSep"))} ${t("audit.more", { count: names.length - 3 })}` : names.join(t("audit.listSep")));

/** "20.00" -> "20", "12.50" -> "12.5"; a typed "20" stays "20". */
const plain = (v: string) => (v.includes(".") ? v.replace(/\.?0+$/, "") : v);

export function targetText(t: TFunction, p: Rules, n: Names): string {
  if (p.scope === "order") return t("promos.wholeOrder");
  if (p.scope === "category") return list(t, p.category_ids.map(n.category));
  return list(t, p.variant_ids.map(n.variant));
}

const slotText = (t: TFunction, s: ComboSlot, n: Names) => `${s.quantity}× ${s.category_id ? n.category(s.category_id) : list(t, s.variant_ids.map(n.variant))}`;

/** "20% off Latte (Small)", "10 off the whole order", "1× Drinks + 1× Cake (Slice) for 80.00". */
export function whatText(t: TFunction, p: Rules, n: Names): string {
  if (p.kind === "combo") return t("promos.sentence.combo", { parts: p.slots.map((s) => slotText(t, s, n)).join(" + "), price: n.money(p.combo_price ?? "0.00") });
  const value = p.discount_type === "percentage" ? `${plain(p.discount_value ?? "0")}%` : n.money(p.discount_value ?? "0.00");
  return t("promos.sentence.discount", { value, target: targetText(t, p, n) });
}

/** Monday = 0, like the server. A fixed Monday (2024-01-01) gives the weekday names in the UI language. */
export const dayName = (d: number, locale: string, width: "short" | "long" = "short") =>
  new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + d)));

export function whenText(t: TFunction, p: Rules, n: Names): string {
  const parts: string[] = [];
  if (p.starts_on && p.ends_on) parts.push(t("promos.sentence.between", { from: p.starts_on, to: p.ends_on }));
  else if (p.starts_on) parts.push(t("promos.sentence.from", { date: p.starts_on }));
  else if (p.ends_on) parts.push(t("promos.sentence.until", { date: p.ends_on }));
  if (p.days_of_week.length > 0 && p.days_of_week.length < 7) parts.push(p.days_of_week.map((d) => dayName(d, n.locale)).join(t("audit.listSep")));
  if (p.window_start && p.window_end) parts.push(`${p.window_start}–${p.window_end}`);
  return parts.length ? parts.join(" · ") : t("promos.always");
}
