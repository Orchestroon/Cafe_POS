import { expect, test } from "@playwright/test";
import { api, authFile } from "../helpers";

test.use({ storageState: authFile("admin") });

test("AT-16: an admin posts a purchase once; stock and one expense", async ({ page }) => {
  const a = await api("admin");
  const oat = (await a.get("/ingredients", { search: "Oat Milk" })).data.find((i: { name: string }) => i.name === "Oat Milk");
  const before = (await a.get("/inventory/balances", { search: "Oat Milk" })).data.find((b: { ingredient_id: string }) => b.ingredient_id === oat.id).qty;
  const expensesBefore = (await a.get("/expenses", { page_size: "1" })).meta.total_count;

  await page.goto("/admin/purchases/new");
  await page.getByLabel("Supplier invoice no.").fill("E2E-1");
  const ing = page.getByLabel("Ingredients").first();
  if (!(await ing.isVisible())) await page.getByRole("button", { name: "+ Add item" }).click();
  await page.getByLabel("Ingredients").first().selectOption({ label: "Oat Milk (ml)" });
  await page.getByLabel("Entry").first().selectOption("pack");
  await page.getByLabel("Packs").first().fill("12");
  await page.getByLabel("Pack size").first().fill("1000");
  await page.getByLabel("Cost per pack").first().fill("55");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Post purchase" })).toBeEnabled();
  await page.getByRole("button", { name: "Post purchase" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Post \(cannot be undone\)/ }).click();
  await expect(page.getByText(/Stock and the expense were recorded once/)).toBeVisible();

  const after = (await a.get("/inventory/balances", { search: "Oat Milk" })).data.find((b: { ingredient_id: string }) => b.ingredient_id === oat.id).qty;
  expect(Number(after) - Number(before)).toBe(12000);
  expect((await a.get("/expenses", { page_size: "1" })).meta.total_count).toBe(expensesBefore + 1);
});
