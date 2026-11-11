import { describe, expect, it } from "vitest";
import { addMoney, cmpMoney, fromUnits, isDec, lineTotal, normMoney, packCostFrom, packQty, perUnitQty, roundUpTo, subMoney, toUnits, unitCostFromPack } from "./decimal";

describe("decimal strings (spec 5.1, no floats)", () => {
  it("parses and prints scaled integers", () => {
    expect(toUnits("12.5")).toBe(1250n);
    expect(toUnits("0.07")).toBe(7n);
    expect(toUnits("abc")).toBe(0n);
    expect(toUnits("1.234", 3)).toBe(1234n);
    expect(fromUnits(-5n)).toBe("-0.05");
    expect(fromUnits(123456n, 3)).toBe("123.456");
  });
  it("validates decimal places", () => {
    expect(isDec("10", 2)).toBe(true);
    expect(isDec(" 10.25 ", 2)).toBe(true);
    expect(isDec("10.255", 2)).toBe(false);
    expect(isDec("-1", 2)).toBe(false);
    expect(isDec("1e3", 2)).toBe(false);
  });
  it("adds, subtracts and compares money exactly", () => {
    expect(addMoney("0.10", "0.20")).toBe("0.30"); // 0.1 + 0.2 in floats is 0.30000000000000004
    expect(subMoney("200.00", "120.00")).toBe("80.00");
    expect(subMoney("1.00", "1.01")).toBe("-0.01");
    expect(cmpMoney("80", "80.00")).toBe(0);
    expect(cmpMoney("79.99", "80")).toBe(-1);
    expect(normMoney("5")).toBe("5.00");
  });
  it("rounds quick-cash buttons up", () => {
    expect(roundUpTo("120.00", 50)).toBe("150.00");
    expect(roundUpTo("150.00", 50)).toBe("150.00");
    expect(roundUpTo("0.01", 100)).toBe("100.00");
  });
  it("AT-03: 12 g + 5% waste = 12.600 g, applied once", () => {
    expect(perUnitQty("12", "5")).toBe("12.600");
    expect(perUnitQty("0.333", "33.33")).toBe("0.444"); // half up at 3 dp
  });
  it("purchase pack helpers round half up", () => {
    expect(unitCostFromPack("55.00", "1000")).toBe("0.0550");
    expect(unitCostFromPack("10", "3")).toBe("3.3333");
    expect(unitCostFromPack("10", "0")).toBe("");
    expect(packQty("12", "1000")).toBe("12000.000");
    expect(lineTotal("12000", "0.0550")).toBe("660.00");
    expect(packCostFrom("0.0550", "1000")).toBe("55.0000");
  });
});
