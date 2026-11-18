import { expect, test } from "@playwright/test";
import { api, authFile, ensureShift, expectNoSideScroll, loaded, sellSmallCash } from "../helpers";

// Responsive QA (spec 11): POS, Orders, Shift and Receipt on phone, tablet and desktop, EN and AR.
// Machine checks: no sideways scroll, the main action is reachable. Screenshots are saved for the
// owner to look at: e2e/artifacts/screens/<lang>-<device>-<page>.png
const DEVICES = { phone: { width: 375, height: 812 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1280, height: 800 } };
test.use({ storageState: authFile("barista1") });

let orderId = "";
test.beforeAll(async () => {
  const b = await api("barista1");
  await ensureShift(b);
  orderId = (await sellSmallCash(b)).order_id;
});

for (const lang of ["en", "ar"] as const) {
  for (const [device, viewport] of Object.entries(DEVICES)) {
    test(`${lang} ${device}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((l) => localStorage.setItem("lang", l), lang);
      const shot = (name: string) => page.screenshot({ path: `e2e/artifacts/screens/${lang}-${device}-${name}.png`, fullPage: true });

      await page.goto("/pos");
      await loaded(page);
      await expect(page.locator(".product-tile").first()).toBeVisible();
      await expectNoSideScroll(page);
      // The cart is a bottom sheet below 1025px (phone and tablet), a side panel on a desktop.
      if (viewport.width < 1025) await expect(page.locator(".pos-cartbar button")).toBeVisible();
      else await expect(page.locator(".pos-cart .btn-primary").first()).toBeVisible();
      await shot("pos");

      await page.goto("/orders");
      await loaded(page);
      // Sprint 5 P11: cards on a phone, the table elsewhere.
      await expect(page.locator(device === "phone" ? ".order-card" : "table.orders-table").first()).toBeVisible();
      await expectNoSideScroll(page);
      await shot("orders");

      // Step 2: Shift & Close and Orders / Refund are panels on the POS now.
      await page.goto("/pos");
      await loaded(page);
      await page.getByRole("button", { name: /Shift & Close|الوردية والإغلاق/ }).click();
      await expect(page.locator(".drawer .shift-report")).toBeVisible();
      await expectNoSideScroll(page);
      await shot("shift");

      await page.goto(`/orders/${orderId}/receipt`);
      await loaded(page);
      await expect(page.locator(".receipt")).toBeVisible();
      await expectNoSideScroll(page);
      await shot("receipt");
    });
  }
}
