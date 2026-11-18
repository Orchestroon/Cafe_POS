import { describe, expect, it } from "vitest";
import { isBareLayout, landingPath } from "./layout";

describe("isBareLayout", () => {
  it("hides the sidebar for a Barista everywhere", () => {
    for (const p of ["/pos", "/orders", "/orders/1", "/shift/1", "/expenses"]) expect(isBareLayout("barista", p)).toBe(true);
  });
  it("hides it for an Admin only on the POS", () => {
    expect(isBareLayout("admin", "/pos")).toBe(true);
    expect(isBareLayout("admin", "/")).toBe(false);
    expect(isBareLayout("admin", "/orders")).toBe(false);
    expect(isBareLayout("admin", "/admin/products")).toBe(false);
    expect(isBareLayout("admin", "/posters")).toBe(false);
  });
  it("keeps the sidebar before the user is known", () => {
    expect(isBareLayout(undefined, "/pos")).toBe(false);
  });
});

describe("landingPath", () => {
  it("sends a Barista to the POS whatever page they came from", () => {
    expect(landingPath("barista")).toBe("/pos");
    expect(landingPath("barista", "/orders")).toBe("/pos");
  });
  it("sends an Admin back to where they were, else the overview", () => {
    expect(landingPath("admin")).toBe("/");
    expect(landingPath("admin", "/admin/users")).toBe("/admin/users");
  });
});
