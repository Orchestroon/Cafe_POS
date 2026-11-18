// Live cost of one serving of a size (Step 3): the draft recipe at today's average costs.
// Same arithmetic as the server: base quantity incl. waste (3 dp) x cost per base unit (6 dp),
// summed and rounded half up to 2 dp. An unknown cost is never counted as 0 (D20).
import { isDec, marginPct, netOfTax, perUnitQty, servingCost, subMoney } from "./decimal";
import { toBase, validEntry, type EntryUnit } from "./units";

export interface CostLine { ingredient_id: string; qty: string; unit: EntryUnit; waste: string }
export interface RecipeCost {
  cost: string | null;        // null: no usable line, or an ingredient has no cost
  profit: string | null;      // gross profit: price (net of included tax) - cost
  margin: string | null;      // gross margin %, 1 dp
  missing: string[];          // ingredient ids on usable lines that have no cost yet
}

/** Rows that are not fully typed yet (no ingredient, bad quantity or waste) are ignored, as in the
 * consumption preview; saving validates them. */
export function recipeCost(lines: CostLine[], unitCostOf: (ingredientId: string) => string | null, price: string, includedTaxRate: string | null): RecipeCost {
  const rows = lines
    .filter((l) => l.ingredient_id && validEntry(l.qty.trim(), l.unit) && isDec(l.waste.trim() || "0", 2))
    .map((l) => ({ id: l.ingredient_id, qty: perUnitQty(toBase(l.qty.trim(), l.unit), l.waste.trim() || "0"), unitCost: unitCostOf(l.ingredient_id) }));
  const missing = [...new Set(rows.filter((r) => r.unitCost === null).map((r) => r.id))];
  const cost = rows.length > 0 && missing.length === 0 ? servingCost(rows) : null;
  const priced = cost !== null && isDec(price, 2);
  return {
    cost,
    profit: priced ? subMoney(netOfTax(price, includedTaxRate), cost) : null,
    margin: priced ? marginPct(price, cost, includedTaxRate) : null,
    missing,
  };
}
