// Recipe units (owner, 2026-11-16). Ingredients are stored in their base unit (g, ml, pcs) and
// recipes keep base quantities (3 dp) — unchanged. The editor also lets you type kg or L; the
// value is converted to the base unit before saving. Scaled integers only, never floats (spec 5.1).
import type { Unit } from "../api/types";
import { fromUnits, isDec, toUnits } from "./decimal";

export type EntryUnit = Unit | "kg" | "L";

/** The units you can type for an ingredient stored in `base`. */
export const unitsFor = (base: Unit): EntryUnit[] => (base === "g" ? ["g", "kg"] : base === "ml" ? ["ml", "L"] : ["pcs"]);

const isLarge = (u: EntryUnit) => u === "kg" || u === "L";

/** Can `qty` in `unit` be stored as a base quantity with 3 decimals? (kg/L: up to 6 decimals) */
export const validEntry = (qty: string, unit: EntryUnit) => isDec(qty, isLarge(unit) ? 6 : 3);

/** "0.015" kg → "15.000" (g). Caller checks validEntry first. */
export function toBase(qty: string, unit: EntryUnit): string {
  return isLarge(unit) ? fromUnits(toUnits(qty, 6), 3) : fromUnits(toUnits(qty, 3), 3);
}

/** Drop trailing zeros: "15.000" → "15", "0.150" → "0.15". */
export const trim = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/** A base quantity for reading: 1 000 g and more as kg, 1 000 ml and more as L. */
export function readable(base: string, unit: Unit): { qty: string; unit: EntryUnit } {
  const n = toUnits(base, 3); // base × 1000
  const big = n < 0n ? -n : n;
  if ((unit === "g" || unit === "ml") && big >= 1000000n) return { qty: trim(fromUnits(n, 6)), unit: unit === "g" ? "kg" : "L" };
  return { qty: trim(fromUnits(n, 3)), unit };
}

/** The same base quantity in the large unit, e.g. 15 g → "0.015" kg (for the deduction hint). */
export const inLarge = (base: string) => trim(fromUnits(toUnits(base, 3), 6));

/** base (3 dp) × servings, exact. */
export const times = (base: string, n: number) => fromUnits(toUnits(base, 3) * BigInt(n), 3);

/** a ≥ b for base quantities. */
export const gte = (a: string, b: string) => toUnits(a, 3) >= toUnits(b, 3);

/** A cost per base unit (6 dp) for reading (Sprint 5 L1): per kg / per L for g and ml (0.00157 per g
 * reads as 1.57 per kg), per piece for pcs; 2 dp, half up. */
export function costPer(avg: string, unit: Unit): { amount: string; unit: EntryUnit } {
  const big = unit === "g" || unit === "ml";
  const n = toUnits(avg, 6) * (big ? 1000n : 1n); // money x 1e6
  return { amount: fromUnits((n + 5000n) / 10000n, 2), unit: big ? (unit === "g" ? "kg" : "L") : unit };
}

/** Cost per base unit (6 dp) of a total (2 dp) over a base quantity (3 dp), half up; null for 0. */
export function avgFrom(total: string, baseQty: string): string | null {
  const den = toUnits(baseQty, 3);
  if (den <= 0n) return null;
  const num = toUnits(total, 2) * 10000000n;
  return fromUnits((2n * num + den) / (2n * den), 6);
}
