import { describe, expect, it } from "vitest";
import type { VariantCost } from "../api/types";
import { belowCost, type Draft } from "./promoCost";

const row = (id: string, cat: string, price: string, cost: string | null): VariantCost => ({ variant_id: id, product_name: id, variant_label: "", category_id: cat, price, cost });
const rows = [row("latte", "drinks", "60.00", "23.60"), row("tea", "drinks", "30.00", "5.00"), row("cake", "food", "40.00", "22.00"), row("new", "food", "50.00", null)];
const base: Draft = { kind: "discount", scope: "variant", discountType: "percentage", value: "10", variantIds: [], categoryIds: [], comboPrice: "", slots: [] };

describe("belowCost: discounts", () => {
  it("is quiet while the price after the discount stays above cost", () => {
    expect(belowCost({ ...base, variantIds: ["latte"], value: "50" }, rows).warnings).toEqual([]);
  });
  it("warns with the price after the discount, in cents", () => {
    const w = belowCost({ ...base, variantIds: ["latte"], value: "70" }, rows).warnings;
    expect(w).toEqual([{ kind: "variant", variantId: "latte", priceAfter: "18.00", cost: "23.60" }]);
  });
  it("rounds half up like the server", () => {
    // 60.05 x 10 % = 6.005 -> 6.01 off
    const r = [row("x", "c", "60.05", "0.00")];
    expect(belowCost({ ...base, variantIds: ["x"], value: "10", scope: "variant" }, r).warnings).toEqual([]);
    expect(belowCost({ ...base, variantIds: ["x"], value: "100" }, [row("x", "c", "60.05", "1.00")]).warnings).toHaveLength(1);
  });
  it("a fixed amount never goes below zero and applies per size", () => {
    const w = belowCost({ ...base, discountType: "fixed_amount", value: "40", variantIds: ["latte", "tea"] }, rows).warnings;
    expect(w.map((x) => x.kind === "variant" && x.variantId)).toEqual(["latte", "tea"]); // tea 30 - 40 floors at 0.00, still below its 5.00 cost
  });
  it("counts a category and the whole order", () => {
    expect(belowCost({ ...base, scope: "category", categoryIds: ["food"], value: "60" }, rows).warnings).toHaveLength(1);
    expect(belowCost({ ...base, scope: "order", value: "95" }, rows).warnings.length).toBe(3);
  });
  it("does not guess for a fixed amount off a whole order", () => {
    expect(belowCost({ ...base, scope: "order", discountType: "fixed_amount", value: "500" }, rows).warnings).toEqual([]);
  });
  it("counts sizes with no known cost instead of treating them as 0", () => {
    const c = belowCost({ ...base, scope: "category", categoryIds: ["food"], value: "10" }, rows);
    expect(c.unknown).toBe(1);
  });
  it("ignores an unfinished value", () => {
    expect(belowCost({ ...base, variantIds: ["latte"], value: "" }, rows).warnings).toEqual([]);
  });
});

describe("belowCost: combos", () => {
  const combo: Draft = { ...base, kind: "combo", scope: "", discountType: "", slots: [{ quantity: 1, category_id: "drinks", variant_ids: [] }, { quantity: 1, category_id: null, variant_ids: ["cake"] }] };
  it("is quiet when even the dearest combination is covered", () => {
    expect(belowCost({ ...combo, comboPrice: "60.00" }, rows).warnings).toEqual([]);
  });
  it("warns 'maybe' when only the dearest combination loses money", () => {
    // cheapest 5.00 + 22.00 = 27.00, dearest 23.60 + 22.00 = 45.60
    expect(belowCost({ ...combo, comboPrice: "40.00" }, rows).warnings).toEqual([{ kind: "combo", level: "maybe", price: "40.00", cost: "45.60" }]);
  });
  it("warns 'always' when every combination loses money", () => {
    expect(belowCost({ ...combo, comboPrice: "20.00" }, rows).warnings).toEqual([{ kind: "combo", level: "always", price: "20.00", cost: "27.00" }]);
  });
  it("multiplies by the quantity of a part", () => {
    const two: Draft = { ...combo, slots: [{ quantity: 2, category_id: null, variant_ids: ["latte"] }], comboPrice: "40.00" };
    expect(belowCost(two, rows).warnings[0]).toMatchObject({ level: "always", cost: "47.20" });
  });
  it("says nothing when a part has no known cost", () => {
    const c = belowCost({ ...combo, slots: [{ quantity: 1, category_id: null, variant_ids: ["new"] }], comboPrice: "1.00" }, rows);
    expect(c.warnings).toEqual([]);
    expect(c.unknown).toBe(1);
  });
});
