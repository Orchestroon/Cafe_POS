import { expect, test, type Page } from "@playwright/test";
import { api, authFile, loaded } from "../helpers";

// Products & recipes screen (owner design, 2026-11-16): one editor, one all-or-nothing save.
test.use({ storageState: authFile("admin") });

async function openLatte(page: Page) {
  await page.goto("/admin/products");
  await loaded(page);
  await page.locator(".pr-item", { hasText: "Iced Latte" }).click();
  await expect(page.getByRole("heading", { name: "Iced Latte", level: 3 })).toBeVisible();
}

async function setupOf(name: string) {
  const a = await api("admin");
  const p = (await a.get("/products")).data.find((x: { name: string }) => x.name === name);
  return (await a.get(`/products/${p.id}/setup`)).data;
}

test("edit a recipe in kg: shown as the stock deduction, saved in grams, audited", async ({ page }) => {
  await openLatte(page);
  await page.getByRole("tab", { name: /^Large/ }).click();
  const coffee = page.locator(".pr-line").first();
  await expect(coffee.getByLabel("Ingredient")).toHaveValue(/.+/);
  // Always a real change (a previous run may have left 20 g): 20 g or 22 g, typed in kg.
  const now = await coffee.getByLabel("Quantity").inputValue();
  const [kg, grams, shown, shownKg] = now === "20" ? ["0.022", "22.000", "23.1 g", "= 0.0231 kg"] : ["0.02", "20.000", "21 g", "= 0.021 kg"];
  await coffee.getByLabel("Unit").selectOption("kg");
  await coffee.getByLabel("Quantity").fill(kg);
  await expect(coffee.locator(".pr-deduct")).toContainText(shown); // + 5% waste
  await expect(coffee.locator(".pr-deduct")).toContainText(shownKg);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: /Save product & recipe/ }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const large = (await setupOf("Iced Latte")).variants.find((v: { label: string }) => v.label === "Large");
  expect(large.recipe.lines[0].base_qty).toBe(grams);
  const a = await api("admin");
  const audit = (await a.get("/audit-events", { action: "recipe.replaced" })).data;
  expect(audit.length).toBeGreaterThan(0);
});

test("the preview counts servings and compares with the stock", async ({ page }) => {
  await openLatte(page);
  await page.getByRole("tab", { name: /^Small/ }).click();
  const preview = page.locator(".card", { hasText: "Consumption preview" });
  await expect(preview).toContainText("12.6 g"); // 12 g + 5%
  await preview.getByRole("button", { name: "Increase" }).click();
  await expect(preview).toContainText("25.2 g");
  await expect(page.locator(".card", { hasText: "Main location" })).toContainText("available");
  await expect(page.getByText("If stock is not enough, the sale still goes through.")).toBeVisible();
});

test("discard, and the unsaved-changes guard when leaving", async ({ page }) => {
  await openLatte(page);
  await page.getByRole("tab", { name: /^Small/ }).click();
  const price = page.getByLabel(/Sale price/);
  await price.fill("99.00");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(price).toHaveValue("65.00");
  await price.fill("99.00");
  page.once("dialog", (d) => d.dismiss()); // stay
  await page.locator(".sidebar").getByRole("link", { name: "Barista POS" }).click();
  await expect(page).toHaveURL(/\/admin\/products/);
  page.once("dialog", (d) => d.accept()); // leave and lose the change
  await page.locator(".sidebar").getByRole("link", { name: "Barista POS" }).click();
  await expect(page).toHaveURL(/\/pos$/);
  expect((await setupOf("Iced Latte")).variants.find((v: { label: string }) => v.label === "Small").price).toBe("65.00");
});

test("create a 2-size service product and a stock item in one save each", async ({ page }) => {
  const tag = Date.now() % 100000;
  await page.goto("/admin/products");
  await page.getByRole("button", { name: /Add product/ }).click();
  await page.getByLabel("Product name").fill(`E2E Tea ${tag}`);
  await page.getByLabel("Product type").selectOption("none");
  await page.getByLabel("Size", { exact: true }).fill("Regular");
  await page.getByLabel(/Sale price/).fill("30.00");
  await page.getByRole("button", { name: "+ Add size" }).click();
  await page.getByLabel("Size", { exact: true }).fill("Large");
  await page.getByLabel(/Sale price/).fill("40.00");
  await page.getByRole("button", { name: /Save product & recipe/ }).click();
  await expect(page).toHaveURL(/\?id=/);
  await expect(page.locator(".pr-item", { hasText: `E2E Tea ${tag}` })).toContainText("No stock tracking");
  const tea = await setupOf(`E2E Tea ${tag}`);
  expect(tea.variants.map((v: { label: string; track_stock: boolean }) => `${v.label}:${v.track_stock}`)).toEqual(["Regular:false", "Large:false"]);

  await page.getByRole("button", { name: /Add product/ }).click();
  await page.getByLabel("Product name").fill(`E2E Cookie ${tag}`);
  await page.getByLabel("Product type").selectOption("stock");
  await page.getByLabel(/Sale price/).fill("50.00");
  await page.getByLabel("Stock item sold").selectOption({ label: "Cups 12oz" });
  await page.getByRole("button", { name: /Save product & recipe/ }).click();
  await expect(page.locator(".pr-item", { hasText: `E2E Cookie ${tag}` })).toContainText("Recipe linked");
  const cookie = await setupOf(`E2E Cookie ${tag}`);
  expect(cookie.variants[0].recipe.lines.map((l: { base_qty: string; unit: string }) => `${l.base_qty} ${l.unit}`)).toEqual(["1.000 pcs"]);
});

test("a server error points at the size and saves nothing", async ({ page }) => {
  await openLatte(page);
  await page.getByRole("tab", { name: /^XL/ }).click();
  await page.getByLabel("Size", { exact: true }).fill("Small"); // duplicate name → refused
  await page.getByRole("button", { name: /Save product & recipe/ }).click();
  await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();
  expect((await setupOf("Iced Latte")).variants.map((v: { label: string }) => v.label)).toContain("XL");
});

for (const [lang, w, h] of [["en", 1280, 900], ["ar", 1280, 900], ["ar", 375, 812]] as const) {
  test(`screenshot ${lang} ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript((l) => localStorage.setItem("lang", l), lang);
    await openLatte(page);
    await page.screenshot({ path: `e2e/artifacts/screens/${lang}-${w < 500 ? "phone" : "desktop"}-products.png`, fullPage: true });
  });
}
