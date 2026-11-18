// Sprint 5 P6 (owner, 2026-11-17): what each option adds to a size's cost, computed the same way as
// a sale (sales/consumption.py): an option uses its effect rows for this size, else its "All sizes"
// rows; a replace option takes the recipe line with its slot out and puts its own rows in.
import type { ModifierGroup, ModifierOption } from "../api/types";
import { perUnitQty } from "./decimal";

export interface CostLine { qty: string; unitCost: string | null; slot?: string }

/** The option's rows for this size (its own rows win over "All sizes"), as cost lines. */
export function optionLines(opt: ModifierOption, sizeId: string | undefined, unitCostOf: (ingredientId: string) => string | null): CostLine[] {
  const effects = opt.effects ?? [];
  const own = sizeId ? effects.filter((e) => e.variant_id === sizeId) : [];
  return (own.length ? own : effects.filter((e) => e.variant_id === null)).map((e) => ({
    qty: perUnitQty(e.base_qty, e.waste_pct || "0"),
    unitCost: unitCostOf(e.ingredient_id),
  }));
}

/** The serving's lines once the option is chosen. */
export function withOption(base: CostLine[], group: Pick<ModifierGroup, "mode" | "replacement_slot">, extra: CostLine[]): CostLine[] {
  if (group.mode !== "replace") return [...base, ...extra];
  return [...base.filter((l) => !l.slot || l.slot !== group.replacement_slot), ...extra];
}

/** The option's extra price on this size: its own size price, else its general price. */
export const optionPrice = (opt: ModifierOption, sizeId: string | undefined) =>
  opt.variant_prices.find((p) => p.variant_id === sizeId)?.price_delta ?? opt.price_delta;
