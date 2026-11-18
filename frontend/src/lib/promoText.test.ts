import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { whatText, whenText, type Names } from "./promoText";

// A tiny t(): the real keys are checked by i18n:check; here only the numbers and the layout matter.
const t = ((k: string, o: Record<string, string | number> = {}) => k === "audit.listSep" ? ", " : `${k}${Object.entries(o).map(([a, b]) => ` ${a}=${b}`).join("")}`) as unknown as TFunction;
const n: Names = { variant: (id) => `V:${id}`, category: (id) => `C:${id}`, money: (m) => `${m} EGP`, locale: "en" };
const base = { kind: "discount" as const, scope: "variant" as const, discount_type: "percentage" as const, discount_value: "20.00", variant_ids: ["a"], category_ids: [], combo_price: null, slots: [], starts_on: null, ends_on: null, days_of_week: [], window_start: null, window_end: null };

describe("promoText", () => {
  it("shows a stored 20.00 % as 20% and keeps a typed 20 and 12.5", () => {
    expect(whatText(t, base, n)).toContain("value=20%");
    expect(whatText(t, { ...base, discount_value: "20" }, n)).toContain("value=20%");
    expect(whatText(t, { ...base, discount_value: "12.50" }, n)).toContain("value=12.5%");
    expect(whatText(t, { ...base, discount_value: "100.00" }, n)).toContain("value=100%");
  });
  it("shows a fixed amount as money", () => {
    expect(whatText(t, { ...base, discount_type: "fixed_amount", discount_value: "5.00" }, n)).toContain("value=5.00 EGP");
  });
  it("describes a combo by its parts and price", () => {
    const s = whatText(t, { ...base, kind: "combo", scope: "", discount_type: "", discount_value: null, combo_price: "80.00", variant_ids: [], slots: [{ quantity: 2, category_id: "c1", variant_ids: [] }, { quantity: 1, category_id: null, variant_ids: ["a", "b"] }] }, n);
    expect(s).toContain("parts=2× C:c1 + 1× V:a, V:b");
    expect(s).toContain("price=80.00 EGP");
  });
  it("describes the schedule, or says always", () => {
    expect(whenText(t, base, n)).toBe("promos.always");
    const w = whenText(t, { ...base, days_of_week: [0, 1, 2, 3, 4], window_start: "15:00", window_end: "17:00", starts_on: "2026-12-01" }, n);
    expect(w).toContain("promos.sentence.from date=2026-12-01");
    expect(w).toContain("15:00–17:00");
    expect(whenText(t, { ...base, days_of_week: [0, 1, 2, 3, 4, 5, 6] }, n)).toBe("promos.always");
  });
});
