// "Below cost" warning for the promotion form (owner, D8). Pure: decimal strings in, warnings out.
// Cost = the recipe at today's average costs (before extras), the same figure the Products screen
// shows. A size or an ingredient with no known cost is never counted as 0: it is only counted.
import { isDec, fromUnits, toUnits } from "./decimal";
import type { ComboSlot, PromotionKind, PromotionScope, VariantCost } from "../api/types";

export interface Draft {
  kind: PromotionKind; scope: PromotionScope | ""; discountType: "percentage" | "fixed_amount" | "";
  value: string; variantIds: string[]; categoryIds: string[]; comboPrice: string; slots: ComboSlot[];
}
export type CostWarning =
  | { kind: "variant"; variantId: string; priceAfter: string; cost: string }
  | { kind: "combo"; level: "always" | "maybe"; price: string; cost: string };
export interface CostCheck { warnings: CostWarning[]; unknown: number }

/** Price after the promotion for one size, in cents; null when it can not be known per size. */
function after(price: bigint, d: Draft): bigint | null {
  if (!isDec(d.value, 2)) return null;
  const v = toUnits(d.value);
  if (d.discountType === "percentage") return price - (price * v + 5000n) / 10000n;
  if (d.discountType === "fixed_amount" && d.scope !== "order") return price > v ? price - v : 0n;
  return null; // a fixed amount off a whole order depends on what else is in the cart
}

export function belowCost(d: Draft, rows: VariantCost[]): CostCheck {
  const warnings: CostWarning[] = [];
  let unknown = 0;
  if (d.kind === "discount") {
    const hit = rows.filter((r) => d.scope === "order" || (d.scope === "variant" ? d.variantIds.includes(r.variant_id) : d.categoryIds.includes(r.category_id)));
    for (const r of hit) {
      const left = after(toUnits(r.price), d);
      if (left === null) continue;
      if (r.cost === null) unknown++;
      else if (left < toUnits(r.cost)) warnings.push({ kind: "variant", variantId: r.variant_id, priceAfter: fromUnits(left), cost: r.cost });
    }
    return { warnings, unknown };
  }
  if (!isDec(d.comboPrice, 2) || d.slots.length === 0) return { warnings, unknown };
  let lo = 0n, hi = 0n, known = true;
  for (const s of d.slots) {
    const pool = rows.filter((r) => (s.category_id ? r.category_id === s.category_id : false) || s.variant_ids.includes(r.variant_id));
    if (pool.length === 0) { known = false; continue; }
    const costs = pool.filter((r) => r.cost !== null).map((r) => toUnits(r.cost!));
    unknown += pool.length - costs.length;
    if (costs.length === 0) { known = false; continue; }
    lo += BigInt(s.quantity) * costs.reduce((a, b) => (a < b ? a : b));
    hi += BigInt(s.quantity) * costs.reduce((a, b) => (a > b ? a : b));
  }
  const price = toUnits(d.comboPrice);
  if (known) {
    if (price < lo) warnings.push({ kind: "combo", level: "always", price: d.comboPrice, cost: fromUnits(lo) });
    else if (price < hi) warnings.push({ kind: "combo", level: "maybe", price: d.comboPrice, cost: fromUnits(hi) });
  }
  return { warnings, unknown };
}
