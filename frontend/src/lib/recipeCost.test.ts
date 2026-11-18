import { describe, expect, it } from "vitest";
import { recipeCost, type CostLine } from "./recipeCost";

const costs: Record<string, string | null> = { beans: "0.420000", milk: "0.030000", cup: "1.500000", free: null };
const of = (id: string) => costs[id] ?? null;
const line = (ingredient_id: string, qty: string, unit: CostLine["unit"] = "g", waste = "0"): CostLine => ({ ingredient_id, qty, unit, waste });

describe("recipeCost", () => {
  it("sums quantity x cost, converting kg and adding waste", () => {
    // 12 g beans + 5% waste = 12.600 g x 0.42 = 5.292 ; 0.2 L milk = 200 ml x 0.03 = 6 ; 1 cup x 1.5
    const r = recipeCost([line("beans", "12", "g", "5"), line("milk", "0.2", "L"), line("cup", "1", "pcs")], of, "65.00", null);
    expect(r.cost).toBe("12.79");
    expect(r.profit).toBe("52.21");
    expect(r.margin).toBe("80.3");
    expect(r.missing).toEqual([]);
  });
  it("a missing cost gives no cost, profit or margin, and names the ingredient", () => {
    const r = recipeCost([line("beans", "10"), line("free", "5")], of, "65.00", null);
    expect(r).toEqual({ cost: null, profit: null, margin: null, missing: ["free"] });
  });
  it("takes an included tax off the price first", () => {
    const r = recipeCost([line("cup", "1", "pcs")], of, "114.00", "14.00"); // 100 net - 1.50
    expect(r.profit).toBe("98.50");
    expect(r.margin).toBe("98.5");
  });
  it("shows cost but no profit for an empty or invalid price", () => {
    expect(recipeCost([line("cup", "1", "pcs")], of, "", null)).toEqual({ cost: "1.50", profit: null, margin: null, missing: [] });
    expect(recipeCost([line("cup", "1", "pcs")], of, "abc", null).profit).toBeNull();
  });
  it("a zero price has a negative profit and no margin", () => {
    const r = recipeCost([line("cup", "1", "pcs")], of, "0.00", null);
    expect(r.profit).toBe("-1.50");
    expect(r.margin).toBeNull();
  });
  it("ignores rows that are not fully typed; no usable row means no cost", () => {
    expect(recipeCost([line("", "1"), line("beans", "x")], of, "10.00", null).cost).toBeNull();
    expect(recipeCost([line("cup", "1", "pcs"), line("beans", "")], of, "10.00", null).cost).toBe("1.50");
  });
});
