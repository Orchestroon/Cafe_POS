import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { api, authFile } from "../helpers";

// Step 4 polish: ingredient "+" in a purchase, the M / L / XL size preset, error boxes, sidebar marker.
test.use({ storageState: authFile("admin") });

test("a new ingredient can be created inside a purchase and posted without leaving the form", async ({ page }) => {
  const a = await api("admin");
  const name = `E2E Cocoa ${randomUUID().slice(0, 6)}`;
  await page.goto("/admin/purchases/new");
  await page.getByRole("button", { name: "New ingredient" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill(name);
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByLabel("Ingredients").first().locator("option:checked")).toContainText(name); // selected on the line
  await page.getByLabel("Quantity").first().fill("2");
  await page.getByLabel("Unit").first().selectOption("kg");
  await page.getByLabel("Total paid").first().fill("50");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Post purchase" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Post \(cannot be undone\)/ }).click();
  await expect(page.getByText(/Stock and the expense were recorded once/)).toBeVisible();
  const id = page.url().split("/").pop()!;
  const p = (await a.get(`/purchases/${id}`)).data;
  expect(p.receipt_no).toMatch(/^PUR-\d+$/);
  const ing = (await a.get("/ingredients", { search: name })).data[0];
  expect([ing.stock_qty, ing.avg_cost]).toEqual(["2000.000", "0.025000"]); // 50 / 2000 g
});

test("the M / L / XL preset replaces the untouched default size, or adds what is missing; + Add size names M, L, XL in turn", async ({ page }) => {
  await page.goto("/admin/products?id=new");
  const tabs = page.locator(".pr-sizes").getByRole("tab"); // the size tabs only
  await page.getByRole("button", { name: "+ M / L / XL" }).click();
  await expect(tabs).toHaveText([/^M/, /^L/, /^XL/]); // "Regular" was replaced
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "+ M / L / XL" })).toBeDisabled(); // nothing left to add
  await page.getByRole("button", { name: "+ Add size" }).click();
  await expect(tabs.last()).toContainText("New size"); // all three names are used

  await page.goto("/admin/products?id=new");
  await page.getByLabel("Size", { exact: true }).fill("Cup"); // touched: the preset appends instead
  await page.getByRole("button", { name: "+ Add size" }).click(); // auto name M
  await expect(page.getByLabel("Size", { exact: true })).toHaveValue("M");
  await page.getByRole("button", { name: "+ M / L / XL" }).click(); // only L and XL are missing
  await expect(tabs).toHaveText([/^Cup/, /^M/, /^L/, /^XL/]);
  await expect(page.getByLabel("Size", { exact: true })).toHaveValue("L");
});

test("errors render in a boxed error alert; the active sidebar item has its marker", async ({ page }) => {
  await page.goto("/admin/purchases/new");
  await page.getByRole("button", { name: "Save" }).click(); // an empty line
  const box = page.locator(".alert-error[role=alert]");
  await expect(box).toBeVisible();
  await expect(box).not.toContainText("{"); // a sentence, never raw JSON
  const edge = await box.evaluate((el) => getComputedStyle(el).borderInlineStartWidth);
  expect(parseFloat(edge)).toBeGreaterThanOrEqual(3); // 4px, drawn at the app zoom
  const marker = await page.locator(".sidebar .nav-link.active").evaluate((el) => getComputedStyle(el, "::before").opacity);
  expect(marker).toBe("1");
});
