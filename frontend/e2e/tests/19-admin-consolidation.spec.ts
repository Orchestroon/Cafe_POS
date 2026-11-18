import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { api, authFile, ensureShift, loaded } from "../helpers";

// Step 3 (owner, 2026-11-18): merged Admin pages with tabs, quick-create "+" buttons, filtered
// deep links from the overview, shift detail under Register sessions, the live recipe cost bar.
test.use({ storageState: authFile("admin") });

const sidebar = (page: import("@playwright/test").Page) => page.locator(".sidebar");

test("the sidebar has one entry per area and tabs switch between the merged pages", async ({ page }) => {
  await page.goto("/admin/products");
  await loaded(page);
  for (const gone of ["Modifiers", "Categories", "Ingredients", "Suppliers", "Purchases & receiving"]) {
    await expect(sidebar(page).getByRole("link", { name: gone, exact: true })).toHaveCount(0);
  }
  const menu = sidebar(page).getByRole("link", { name: "Menu & Recipes" });
  await expect(menu).toHaveClass(/active/);
  await page.getByRole("tab", { name: "Modifiers" }).click();
  await expect(page).toHaveURL(/\/admin\/modifiers/);
  await expect(menu).toHaveClass(/active/); // still the same sidebar entry
  await page.getByRole("tab", { name: "Categories" }).click();
  await expect(page).toHaveURL(/\/admin\/categories/);

  await page.goto("/admin/suppliers");
  await expect(sidebar(page).getByRole("link", { name: "Buying & Suppliers" })).toHaveClass(/active/);
  await page.getByRole("tab", { name: "Purchases & receiving" }).click();
  await expect(page).toHaveURL(/\/admin\/purchases/);

  await page.goto("/admin/ingredients"); // old bookmark
  await expect(page).toHaveURL(/\/admin\/inventory/);
  await expect(sidebar(page).getByRole("link", { name: "Inventory & Stock" })).toHaveClass(/active/);
});

test("Inventory & Stock: one table with quantity, unit, average cost and threshold; new ingredient and edit from it", async ({ page }) => {
  const name = `E2E Sugar ${randomUUID().slice(0, 6)}`;
  await page.goto("/admin/inventory");
  await loaded(page);
  await expect(page.getByRole("columnheader", { name: "Average cost" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Low-stock threshold" })).toBeVisible();
  await page.getByRole("button", { name: /\+ New ingredient/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill(name);
  await dlg.getByLabel("Low-stock threshold").fill("500");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg).toBeHidden();
  await page.getByLabel("Search").fill(name);
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText("No price yet");
  await expect(row).toContainText("500");
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("dialog").getByLabel("Unit")).toBeDisabled(); // the unit never changes after creation
});

test("the overview alert cards link to the filtered views", async ({ page }) => {
  const a = await api("admin");
  const name = `E2E NoPrice ${randomUUID().slice(0, 6)}`;
  await a.post("/ingredients", { name, base_unit: "g" }); // active, never stocked: no price
  await page.goto("/");
  await loaded(page);
  await expect(page.getByRole("heading", { name: "Shortcuts" })).toHaveCount(0);
  await page.getByRole("link", { name: /Ingredients without a price/ }).click();
  await expect(page).toHaveURL(/\/admin\/inventory\?flag=no-price/);
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByLabel("Status")).toHaveValue("no-price");

  await page.goto("/");
  await page.getByRole("link", { name: /Low stock/ }).click();
  await expect(page).toHaveURL(/\/admin\/inventory\?flag=low/);
  await expect(page.getByLabel("Status")).toHaveValue("low");
});

test("a size without a recipe is listed by the overview card's filter", async ({ page }) => {
  const a = await api("admin");
  const tag = randomUUID().slice(0, 6);
  const cat = (await a.get("/categories")).data[0];
  await a.post("/products/setup", { // a tracked size with no recipe: cannot be sold
    product: { name: `E2E NoRecipe ${tag}`, category_id: cat.id, description: "", sort_order: 0, is_active: true },
    variants: [{ label: "Regular", sku: null, price: "10.00", sort_order: 0, is_active: true, track_stock: true, recipe: [] }],
    modifier_groups: [],
  });
  await page.goto("/admin/products?filter=no-recipe");
  await loaded(page);
  await expect(page.locator(".pr-item", { hasText: `E2E NoRecipe ${tag}` })).toBeVisible();
  await expect(page.locator(".pr-item", { hasText: "Iced Latte" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show all" }).click();
  await expect(page.locator(".pr-item", { hasText: "Iced Latte" })).toBeVisible();
});

test("quick-create: a new category in the product form and a new supplier in the purchase form", async ({ page }) => {
  const tag = randomUUID().slice(0, 6);
  await page.goto("/admin/products?id=new");
  await page.getByRole("button", { name: "New category" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(`E2E Cat ${tag}`);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".pr-editor").getByLabel("Category", { exact: true }).locator("option:checked")).toHaveText(`E2E Cat ${tag}`);

  await page.goto("/admin/purchases/new");
  await page.getByRole("button", { name: "New supplier" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(`E2E Sup ${tag}`);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Supplier", { exact: true }).locator("option:checked")).toHaveText(`E2E Sup ${tag}`);
});

test("shift Details stays under Register sessions, Back returns, and old /shift/:id redirects", async ({ page }) => {
  const b = await api("barista2");
  await ensureShift(b);
  await page.goto("/admin/shifts");
  await loaded(page);
  await page.getByRole("link", { name: "Details" }).first().click();
  await expect(page).toHaveURL(/\/admin\/shifts\/[0-9a-f-]{36}$/);
  await expect(sidebar(page).getByRole("link", { name: "Register sessions" })).toHaveClass(/active/);
  const id = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/admin\/shifts$/);
  await page.goto(`/shift/${id}`);
  await expect(page).toHaveURL(new RegExp(`/admin/shifts/${id}$`));
});

test("Reports: quick date presets, and Stock has no cashier or shift filter", async ({ page }) => {
  await page.goto("/admin/reports/sales-summary");
  await loaded(page);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(d);
  await page.getByRole("button", { name: "Yesterday" }).click();
  const yest = day(new Date(Date.now() - 86400000));
  await expect(page.getByLabel("From")).toHaveValue(yest);
  await expect(page.getByLabel("To")).toHaveValue(yest);
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await expect(page.getByLabel("To")).toHaveValue(day(new Date()));
  await page.getByRole("button", { name: "This month" }).click();
  await expect(page.getByLabel("From")).toHaveValue(/-01$/);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/admin/reports/stock");
  await loaded(page);
  await expect(page.getByRole("button", { name: "Yesterday" })).toBeVisible();
  await expect(page.getByLabel("Cashier")).toHaveCount(0);
  await expect(page.getByLabel("Shifts")).toHaveCount(0);
});

test("the recipe cost bar moves as you type and warns about an ingredient with no cost", async ({ page }) => {
  const a = await api("admin");
  const tag = randomUUID().slice(0, 6);
  const bare = (await a.post("/ingredients", { name: `E2E Bare ${tag}`, base_unit: "g" })).data;
  await page.goto("/admin/products");
  await loaded(page);
  await page.locator(".pr-item", { hasText: "Iced Latte" }).click();
  await page.getByRole("tab", { name: /^Small/ }).click();
  const bar = page.getByRole("group", { name: "Recipe cost and margin" });
  await expect(bar).toContainText("Gross profit");
  await expect(bar).toContainText("Gross margin %");
  await expect(bar.getByRole("link", { name: /Profit Report/ })).toHaveAttribute("href", "/admin/reports/profit");
  await expect(bar).not.toContainText("No price yet for");

  const cost = bar.locator('[data-metric="cost"]');
  const before = await cost.innerText();
  const first = page.locator(".pr-line").first();
  await first.getByLabel("Quantity").fill("40"); // more beans: the cost must change at once
  await expect(cost).not.toHaveText(before);

  await page.getByRole("button", { name: /Add ingredient/ }).click();
  await page.locator(".pr-line").last().getByLabel("Ingredient").selectOption({ value: bare.id });
  await page.locator(".pr-line").last().getByLabel("Quantity").fill("5");
  await expect(page.locator(".pr-line").last()).toContainText("No price yet"); // badge on the row
  await expect(bar).toContainText(`No price yet for: E2E Bare ${tag}`);
  await expect(cost).toHaveText("—"); // never a partial number
  await page.getByRole("button", { name: "Discard changes" }).click();
});
