import { expect, test } from "@playwright/test";
import { api, authFile } from "../helpers";

// B3 (owner, 2026-11-11): a size with no recipe cannot be sold until it gets a recipe or the
// Admin ticks off "Track stock".
test("a new size without a recipe is greyed out at the till until it is set up", async ({ browser }) => {
  const a = await api("admin");
  const latte = (await a.get("/products")).data.find((p: { name: string }) => p.name === "Iced Latte");
  const label = `Kids ${Date.now() % 100000}`;
  const size = (await a.post(`/products/${latte.id}/variants`, { label, price: "30.00", sort_order: 9 })).data;

  const admin = await browser.newPage({ storageState: authFile("admin") });
  await admin.goto("/admin/products");
  await expect(admin.getByText(`${label}`).first()).toContainText("No recipe");
  await admin.close();

  const page = await browser.newPage({ storageState: authFile("barista1") });
  await page.goto("/pos");
  await page.getByRole("button", { name: /Iced Latte/ }).click();
  const kids = page.getByRole("dialog", { name: "Iced Latte" }).getByRole("radio", { name: new RegExp(label) });
  await expect(kids).toBeDisabled();
  await expect(kids).toContainText("No recipe");

  // The Admin marks it as "no stock tracking": it becomes sellable.
  await a.raw.patch(`/api/v1/variants/${size.id}`, { data: { track_stock: false }, headers: a.headers() });
  await page.reload();
  await page.getByRole("button", { name: /Iced Latte/ }).click();
  await expect(page.getByRole("dialog", { name: "Iced Latte" }).getByRole("radio", { name: new RegExp(label) })).toBeEnabled();
  await page.close();
});
