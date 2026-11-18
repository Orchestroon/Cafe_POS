import { describe, expect, it } from "vitest";
import type { ModifierOption } from "../api/types";
import { servingCost } from "./decimal";
import { optionLines, optionPrice, withOption } from "./optionCost";

const costs: Record<string, string> = { coffee: "0.620000", milk: "0.030000", oat: "0.100000", cup: "1.500000" };
const uc = (id: string) => costs[id] ?? null;
const opt = (o: Partial<ModifierOption>): ModifierOption => ({ id: "o", label: "x", price_delta: "15.00", sort_order: 0, is_active: true, track_stock: true, variant_prices: [], effects: [], ...o });
// Small Iced Latte: 12.6 g coffee (12 + 5%), 200 ml milk in the "milk" slot, 1 cup.
const small = [{ qty: "12.600", unitCost: uc("coffee") }, { qty: "200.000", unitCost: uc("milk"), slot: "milk" }, { qty: "1.000", unitCost: uc("cup") }];

describe("option cost on a size (P6)", () => {
  it("a replace option swaps the slot line for its own rows", () => {
    const oat = opt({ effects: [{ variant_id: "S", ingredient_id: "oat", base_qty: "180.000", waste_pct: "0" }] });
    const lines = withOption(small, { mode: "replace", replacement_slot: "milk" }, optionLines(oat, "S", uc));
    expect(servingCost(small)).toBe("15.31"); // 7.812 + 6 + 1.5
    expect(servingCost(lines)).toBe("27.31"); // 7.812 + 18 + 1.5
  });
  it("an add option adds its rows; its own size rows win over All sizes", () => {
    const shot = opt({ effects: [
      { variant_id: null, ingredient_id: "coffee", base_qty: "8.000", waste_pct: "5.00" },
      { variant_id: "L", ingredient_id: "coffee", base_qty: "10.000", waste_pct: "0" },
    ] });
    expect(servingCost(withOption(small, { mode: "add" }, optionLines(shot, "S", uc)))).toBe("20.52"); // + 8.4 g
    expect(optionLines(shot, "L", uc)).toEqual([{ qty: "10.000", unitCost: "0.620000" }]);
  });
  it("no price for an ingredient means no cost, never 0", () => {
    const x = opt({ effects: [{ variant_id: null, ingredient_id: "unknown", base_qty: "1", waste_pct: "0" }] });
    expect(servingCost(withOption(small, { mode: "add" }, optionLines(x, "S", uc)))).toBeNull();
  });
  it("price: the size's own price, else the general one", () => {
    const o = opt({ variant_prices: [{ variant_id: "L", price_delta: "20.00" }] });
    expect(optionPrice(o, "L")).toBe("20.00");
    expect(optionPrice(o, "S")).toBe("15.00");
    expect(optionPrice(o, undefined)).toBe("15.00");
  });
});
