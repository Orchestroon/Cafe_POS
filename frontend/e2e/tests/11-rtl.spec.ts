import { expect, test } from "@playwright/test";
import { authFile, expectNoSideScroll } from "../helpers";

// RTL smoke (spec 5.8): Arabic mirrors the layout and shows Arabic text.
test.use({ storageState: authFile("admin") });

test("switching to Arabic mirrors the shell and translates it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "عربي" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  const sidebar = (await page.locator(".sidebar").boundingBox())!;
  expect(sidebar.x, "sidebar should be on the right").toBeGreaterThan(640);
  await expect(page.locator(".sidebar")).toContainText("نقطة البيع");
  // The Arabic font is Cairo, and it really loaded (not a system fallback).
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(font).toMatch(/^"?Cairo/);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check("16px Cairo", "نقطة البيع"))).toBe(true);
  for (const path of ["/", "/pos", "/orders", "/shift", "/admin/products", "/admin/reports/sales-summary", "/admin/audit"]) {
    await page.goto(path);
    await expect(page.locator(".view-container")).not.toBeEmpty();
    await expectNoSideScroll(page);
  }
  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
