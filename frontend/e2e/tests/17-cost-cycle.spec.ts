import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { api, authFile, loaded } from "../helpers";

// Sprint 5 (owner, 2026-11-17): nothing enters without a known cost and source. A purchase is
// the quantity and what was paid; credit purchases are paid later, in parts; an opening balance
// always has its value; adjustments only take stock out.

test.use({ storageState: authFile("admin") });

test("a purchase is quantity + total paid; the system works out the cost per unit (L4)", async ({ page }) => {
  const a = await api("admin");
  const coffee = (await a.get("/ingredients", { search: "Coffee Beans" })).data[0];
  await page.goto("/admin/purchases/new");
  await page.getByLabel("Ingredients").first().selectOption({ value: coffee.id });
  await page.getByLabel("Quantity").first().fill("500");
  await page.getByLabel("Unit").first().selectOption("kg");
  await page.getByLabel("Total paid").first().fill("785");
  await expect(page.getByRole("cell", { name: /1\.57/ })).toBeVisible(); // per kg, never typed
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Post purchase" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Post \(cannot be undone\)/ }).click();
  await expect(page.getByText(/Stock and the expense were recorded once/)).toBeVisible();
  const id = page.url().split("/").pop()!;
  const p = (await a.get(`/purchases/${id}`)).data;
  expect([p.total, p.items[0].qty]).toEqual(["785.00", "500000.000"]);
});

test("on credit: stock goes in, then the supplier is paid in parts (P4)", async ({ page }) => {
  const a = await api("admin");
  const supplier = (await a.post("/suppliers", { name: `E2E Dairy ${randomUUID().slice(0, 6)}` })).data;
  const milk = (await a.get("/ingredients", { search: "Whole Milk" })).data[0];
  await page.goto("/admin/purchases/new");
  await page.getByRole("combobox", { name: "Supplier", exact: true }).selectOption({ value: supplier.id });
  await page.getByRole("combobox", { name: "Payment", exact: true }).selectOption("credit");
  await page.getByLabel("Ingredients").first().selectOption({ value: milk.id });
  await page.getByLabel("Quantity").first().fill("10");
  await page.getByLabel("Unit").first().selectOption("L");
  await page.getByLabel("Total paid").first().fill("300");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Post purchase" }).click();
  await expect(page.getByRole("dialog").getByText(/is owed to the supplier/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /Post \(cannot be undone\)/ }).click();
  await expect(page.getByText("On credit")).toBeVisible();
  await page.getByRole("button", { name: "Pay supplier" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Pay now").fill("100");
  await dlg.getByRole("button", { name: /^Pay / }).click();
  await expect(dlg).toBeHidden();
  const id = page.url().split("/").pop()!;
  expect((await a.get(`/purchases/${id}`)).data.owed).toBe("200.00");
  await page.goto("/admin/suppliers");
  await loaded(page);
  await expect(page.getByRole("row", { name: new RegExp(supplier.name) })).toContainText("200.00");
});

test("an opening balance needs its value; adjustments only take stock out (L2/L3)", async ({ page }) => {
  const a = await api("admin");
  const name = `E2E Straw ${randomUUID().slice(0, 6)}`;
  const straw = (await a.post("/ingredients", { name, base_unit: "pcs" })).data;
  await page.goto("/admin/inventory");
  await page.getByRole("tab", { name: "Opening balances" }).click();
  await page.getByLabel(`${name} Quantity`).fill("50");
  await page.getByLabel(`${name} Total value`).fill("25");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Opening balances saved.")).toBeVisible();
  expect((await a.get(`/ingredients/${straw.id}`)).data.avg_cost).toBe("0.500000");

  await page.getByRole("tab", { name: "Adjustment" }).click();
  await expect(page.getByText(/Stock is never added here/)).toBeVisible();
  await page.getByLabel("Ingredients").selectOption({ value: straw.id });
  await page.getByLabel("Quantity to remove").fill("5");
  await page.getByLabel("Reason").fill("Broken");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/new balance 45.000/)).toBeVisible();
});
