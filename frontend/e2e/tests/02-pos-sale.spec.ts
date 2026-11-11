import { expect, test } from "@playwright/test";
import { api, authFile, ensureNoShift } from "../helpers";

test.use({ storageState: authFile("barista1") });

test("B1 + sale: open shift, Large + Oat + Extra Shot, mixed payment, receipt", async ({ page }) => {
  const b = await api("barista1");
  await ensureNoShift(b);

  await page.goto("/pos");
  // B1: the open-shift popup closes with ✕; the till stays locked until a shift is open.
  const dialog = page.getByRole("dialog", { name: "Open shift" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /Iced Latte/ })).toBeDisabled();
  await page.locator(".shift-bar").getByRole("button", { name: /Open shift/ }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Opening cash/).fill("300.00");
  await dialog.locator(".modal-footer").getByRole("button", { name: "Open shift" }).click();
  await expect(page.getByText("Shift open")).toBeVisible();

  // Large + Oat Milk + Extra Shot = 80 + 20 + 20 = 120.00
  await page.getByRole("button", { name: /Iced Latte/ }).click();
  const sheet = page.getByRole("dialog", { name: "Iced Latte" });
  await sheet.getByRole("radio", { name: /Large/ }).click();
  await sheet.getByRole("radio", { name: /Oat Milk/ }).click();
  await sheet.getByRole("checkbox", { name: /Extra Shot/ }).click();
  await sheet.getByRole("button", { name: /Add to cart/ }).click();
  await expect(page.locator(".pos-cart .totals-row.grand")).toContainText("120.00");

  await page.locator(".pos-cart").getByRole("button", { name: /^Pay/ }).click();
  const pay = page.getByRole("dialog", { name: "Payment" });
  await pay.getByRole("tab", { name: "Mixed" }).click();
  await pay.getByLabel("Cash amount").fill("80");
  await expect(pay.getByLabel(/Card amount/)).toHaveValue("40.00");
  await pay.getByRole("button", { name: /Confirm payment/ }).click();

  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible();
  const invoice = (await page.locator(".pos-success .mono").textContent())!.trim();
  expect(invoice).toMatch(/^POS-\d{7}$/);

  // The server's truth: one order, 80 cash + 40 card, Oat replaced the regular milk.
  const a = await api("admin");
  const order = (await a.get("/orders", { invoice_no: invoice })).data[0];
  const detail = (await a.get(`/orders/${order.id}`)).data;
  expect(detail.total).toBe("120.00");
  expect(detail.payments.map((p: { method: string; amount: string }) => `${p.method}:${p.amount}`).sort()).toEqual(["card:40.00", "cash:80.00"]);
  const used = detail.items[0].consumption.map((c: { ingredient_name: string }) => c.ingredient_name);
  expect(used).toContain("Oat Milk");
  expect(used).not.toContain("Whole Milk");

  await page.getByRole("button", { name: "Print receipt" }).click();
  await expect(page.locator(".receipt")).toContainText(invoice);
  await expect(page.locator(".receipt")).toContainText("Iced Latte");
});
