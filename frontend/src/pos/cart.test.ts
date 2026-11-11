import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../api/types";
import { loadCart, loadPending, optionPrice, saveCart, savePending, sellableProducts, toApiItems, type CartLine } from "./cart";

const line = (id: string, qty = 1): CartLine => ({ id, variantId: `v-${id}`, productId: "p", productName: "Latte", variantLabel: "S", quantity: qty, optionIds: ["o1"] });

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe("cart", () => {
  beforeEach(() => vi.stubGlobal("sessionStorage", fakeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("maps lines to the API shape", () => {
    expect(toApiItems([line("a", 2)])).toEqual([{ variant_id: "v-a", quantity: 2, modifier_option_ids: ["o1"] }]);
  });
  it("keeps one cart and one pending sale per user (shared tablet, Sprint 2 H1)", () => {
    saveCart("u1", [line("a")]);
    expect(loadCart("u2")).toEqual([]);
    expect(loadCart("u1")).toHaveLength(1);
    savePending("u1", { key: "k", payload: { items: [], payments: [], expected_total: "0.00" } });
    expect(loadPending("u2")).toBeNull();
    expect(loadPending("u1")?.key).toBe("k");
    saveCart("u1", []);
    expect(loadCart("u1")).toEqual([]);
  });
  it("never throws when storage is blocked", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    expect(() => saveCart("u", [line("a")])).not.toThrow();
    expect(loadCart("u")).toEqual([]);
  });
  it("uses the per-size option price when there is one", () => {
    const opt = { price_delta: "15.00", variant_prices: [{ variant_id: "L", price_delta: "20.00" }] };
    expect(optionPrice(opt, "L")).toBe("20.00");
    expect(optionPrice(opt, "S")).toBe("15.00");
  });
  it("lists only active products with an active size", () => {
    const v = (is_active: boolean) => ({ id: "v", label: "S", sku: null, price: "1.00", sort_order: 0, is_active, track_stock: true, has_recipe: true });
    const p = (id: string, active: boolean, sizes: boolean[]) => ({ id, category_id: "c", name: id, description: "", sort_order: 0, is_active: active, variants: sizes.map(v), modifier_groups: [] }) as Product;
    expect(sellableProducts([p("a", true, [true]), p("b", false, [true]), p("c", true, [false])]).map((x) => x.id)).toEqual(["a"]);
  });
});
