import { describe, expect, it } from "vitest";
import { presetRange } from "./dateRange";

describe("presetRange", () => {
  it("today", () => expect(presetRange("2026-11-18", "today")).toEqual({ from: "2026-11-18", to: "2026-11-18" }));
  it("yesterday crosses a month and a year", () => {
    expect(presetRange("2026-12-01", "yesterday")).toEqual({ from: "2026-11-30", to: "2026-11-30" });
    expect(presetRange("2027-01-01", "yesterday")).toEqual({ from: "2026-12-31", to: "2026-12-31" });
  });
  it("yesterday handles a leap day", () => expect(presetRange("2028-03-01", "yesterday").from).toBe("2028-02-29"));
  it("last 7 days = today + the 6 before", () => {
    expect(presetRange("2026-11-18", "last7")).toEqual({ from: "2026-11-12", to: "2026-11-18" });
    expect(presetRange("2027-01-03", "last7")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });
  it("this month = the 1st through today", () => {
    expect(presetRange("2026-11-18", "thisMonth")).toEqual({ from: "2026-11-01", to: "2026-11-18" });
    expect(presetRange("2026-11-01", "thisMonth")).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  });
});
