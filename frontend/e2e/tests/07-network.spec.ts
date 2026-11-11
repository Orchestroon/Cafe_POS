import { expect, test, type Page } from "@playwright/test";
import { api, authFile, ensureShift, orderCount } from "../helpers";

// AT-20 (spec 10.2): a lost connection during checkout never makes a phantom or duplicate sale.
test.use({ storageState: authFile("barista1") });

async function cartWithSmall(page: Page) {
  await page.goto("/pos");
  await page.getByRole("button", { name: /Iced Latte/ }).click();
  const sheet = page.getByRole("dialog", { name: "Iced Latte" });
  await sheet.getByRole("radio", { name: /Small/ }).click();
  await sheet.getByRole("button", { name: /Add to cart/ }).click();
  await expect(page.locator(".pos-cart .totals-row.grand")).toContainText("65.00");
  await page.locator(".pos-cart").getByRole("button", { name: /^Pay/ }).click();
  return page.getByRole("dialog", { name: "Payment" });
}

test.beforeEach(async () => {
  await ensureShift(await api("barista1"));
});

test("the server commits but the answer is lost: the retry with the same key gives one order", async ({ page }) => {
  const a = await api("admin");
  const before = await orderCount(a);
  const keys: string[] = [];
  let dropped = false;
  await page.route("**/api/v1/orders/checkout", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (!dropped) {
      dropped = true;
      await route.fetch(); // reaches Django, which commits the sale…
      await route.abort("connectionreset"); // …but the browser never sees the 201
      return;
    }
    await route.continue();
  });
  const pay = await cartWithSmall(page);
  await pay.getByRole("button", { name: /Confirm payment/ }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible({ timeout: 20_000 });
  expect(keys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(keys).size).toBe(1); // always the same Idempotency-Key
  expect(await orderCount(a)).toBe(before + 1);
});

test("a 503 from a proxy is resent with the same key; one order", async ({ page }) => {
  const a = await api("admin");
  const before = await orderCount(a);
  const keys: string[] = [];
  await page.route("**/api/v1/orders/checkout", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length === 1) return route.fulfill({ status: 503, body: "Service Unavailable" });
    return route.continue();
  });
  const pay = await cartWithSmall(page);
  await pay.getByRole("button", { name: /Confirm payment/ }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible({ timeout: 20_000 });
  expect(new Set(keys).size).toBe(1);
  expect(await orderCount(a)).toBe(before + 1);
});

test("offline: a clear message, selling paused, nothing created; Retry online gives one order", async ({ page, context }) => {
  const a = await api("admin");
  const before = await orderCount(a);
  const pay = await cartWithSmall(page);
  await context.setOffline(true);
  await pay.getByRole("button", { name: /Confirm payment/ }).click();
  await expect(page.getByText(/Could not confirm the last sale/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".pos-cart").getByRole("button", { name: /^Pay/ })).toBeDisabled();
  expect(await orderCount(a)).toBe(before);
  await context.setOffline(false);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible({ timeout: 20_000 });
  expect(await orderCount(a)).toBe(before + 1);
});
