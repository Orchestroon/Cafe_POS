// Money and quantities are decimal STRINGS everywhere (spec 5.1). These helpers use BigInt scaled
// integers, never floats. The server stays the source of truth; this is for UI arithmetic only
// (change due, mixed-payment remainder, quick-cash buttons, recipe preview).

const pow10 = (dp: number) => 10n ** BigInt(dp);

export const isDec = (s: string, dp: number) => new RegExp(`^\\d+(\\.\\d{1,${dp}})?$`).test(s.trim());

/** "12.5" -> 1250n at dp 2. Caller checks isDec first; garbage becomes 0n. */
export function toUnits(s: string, dp = 2): bigint {
  const t = s.trim();
  if (!isDec(t, dp)) return 0n;
  const [i, f = ""] = t.split(".");
  return BigInt(i) * pow10(dp) + BigInt(f.padEnd(dp, "0"));
}

export function fromUnits(n: bigint, dp = 2): string {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const base = pow10(dp);
  const frac = (a % base).toString().padStart(dp, "0");
  return `${neg ? "-" : ""}${a / base}${dp ? `.${frac}` : ""}`;
}

export const addMoney = (a: string, b: string) => fromUnits(toUnits(a) + toUnits(b));
export const subMoney = (a: string, b: string) => fromUnits(toUnits(a) - toUnits(b));
export const cmpMoney = (a: string, b: string) => {
  const d = toUnits(a) - toUnits(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
};
export const normMoney = (s: string) => fromUnits(toUnits(s));

/** Next multiple of `step` at or above `amount` (quick-cash buttons: 50, 100, 200). */
export function roundUpTo(amount: string, step: number): string {
  const unit = BigInt(step) * pow10(2);
  const v = toUnits(amount);
  return fromUnits(((v + unit - 1n) / unit) * unit);
}

/** Per-unit consumption: base_qty (3 dp) x (1 + waste%/100), rounded half up to 3 dp (spec 8.2). */
export function perUnitQty(baseQty: string, wastePct: string): string {
  const base = toUnits(baseQty, 3);
  const waste = toUnits(wastePct, 2); // hundredths of a percent
  const num = base * (10000n + waste);
  return fromUnits((num + 5000n) / 10000n, 3);
}

/** Pack helper (spec 10.6): cost per base unit (4 dp) = pack cost / pack size, half up. */
export function unitCostFromPack(packCost: string, packSize: string): string {
  const cost = toUnits(packCost, 4);
  const size = toUnits(packSize, 3);
  if (size === 0n) return "";
  return fromUnits((cost * 1000n * 2n + size) / (size * 2n), 4);
}

/** Pack helper: qty (3 dp) = pack_count x pack_size, half up. */
export function packQty(count: string, size: string): string {
  return fromUnits((toUnits(count, 3) * toUnits(size, 3) + 500n) / 1000n, 3);
}

/** Line total preview (2 dp) = qty (3 dp) x unit cost (4 dp), half up. The server's figure is final. */
export function lineTotal(qty: string, unitCost: string): string {
  return fromUnits((toUnits(qty, 3) * toUnits(unitCost, 4) + 50000n) / 100000n, 2);
}

/** Pack cost (4 dp) = unit cost (4 dp) x pack size (3 dp); lets an existing draft show its pack price. */
export function packCostFrom(unitCost: string, packSize: string): string {
  return fromUnits((toUnits(unitCost, 4) * toUnits(packSize, 3) + 500n) / 1000n, 4);
}
