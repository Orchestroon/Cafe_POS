import { expect, test } from "@playwright/test";
import { api, authFile, ensureShift, orderCount } from "../helpers";

// B2: the main keyboard flow, end to end, without the mouse.
test.use({ storageState: authFile("barista1") });

test("help, page jumps, and a whole sale from the keyboard", async ({ page }) => {
  await ensureShift(await api("barista1"));
  const a = await api("admin");
  const before = await orderCount(a);

  await page.goto("/pos");
  await expect(page.getByRole("button", { name: /Iced Latte/ })).toBeEnabled();
  await page.keyboard.press("Shift+Slash"); // ?
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();

  await page.keyboard.press("Alt+KeyO");
  await expect(page).toHaveURL(/\/orders$/);
  await page.keyboard.press("Alt+KeyP");
  await expect(page).toHaveURL(/\/pos$/);

  await page.keyboard.press("Digit1"); // first category
  await expect(page.getByRole("tab", { selected: true })).toHaveText("Cold Drinks");
  await page.keyboard.press("ArrowDown"); // focus the first product
  await expect(page.getByRole("button", { name: /Iced Latte/ })).toBeFocused();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Iced Latte" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Digit2"); // second size = Large
  await expect(sheet.getByRole("radio", { name: /Large/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Enter");
  await expect(sheet).toBeHidden();
  await expect(page.locator(".pos-cart .totals-row.grand")).toContainText("80.00");
  await page.keyboard.press("Equal"); // + quantity
  await expect(page.locator(".pos-cart .totals-row.grand")).toContainText("160.00");
  await page.keyboard.press("Minus");
  await expect(page.locator(".pos-cart .totals-row.grand")).toContainText("80.00");

  await page.keyboard.press("F2");
  const pay = page.getByRole("dialog", { name: "Payment" });
  await expect(pay).toBeVisible();
  await page.keyboard.press("F8"); // Cash → Card
  await expect(pay.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("F8"); // → Mixed
  await page.keyboard.press("F8"); // → Cash
  await expect(pay.getByRole("tab", { name: "Cash" })).toHaveAttribute("aria-selected", "true");
  await pay.getByLabel("Cash received").focus();
  await page.keyboard.press("Enter"); // exact cash
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible();
  expect(await orderCount(a)).toBe(before + 1);
});

test("page shortcuts pause while a popup is open", async ({ page }) => {
  await ensureShift(await api("barista1"));
  await page.goto("/pos");
  await page.getByRole("button", { name: /Iced Latte/ }).click();
  await page.keyboard.press("Alt+KeyO"); // must NOT navigate away from an open popup
  await expect(page).toHaveURL(/\/pos$/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Iced Latte" })).toBeHidden();
});
