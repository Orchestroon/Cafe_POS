import { expect, test } from "@playwright/test";
import { api, authFile, ensureShift, loaded } from "../helpers";

// Money review (owner, 2026-11-16): cash out/in of the drawer, exact pack price, purchase void,
// the money in & out and profit reports, and the cost per serving on the Products screen.

test.describe("barista", () => {
  test.use({ storageState: authFile("barista1") });

  test("takes cash out of the drawer; expected cash drops and the entry is listed", async ({ page }) => {
    const b = await api("barista1");
    await ensureShift(b);
    const before = (await b.get("/shifts/current")).data.totals.expected_cash as string;
    await page.goto("/shift");
    await page.getByRole("button", { name: "Cash out / in" }).click();
    const dlg = page.getByRole("dialog", { name: "Cash out / in" });
    await dlg.getByRole("radio", { name: "Taken out" }).click();
    await dlg.getByLabel("Amount").fill("50.00");
    await dlg.getByLabel("Reason").fill("To the safe");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole("cell", { name: "To the safe" }).first()).toBeVisible();
    const after = (await b.get("/shifts/current")).data.totals.expected_cash as string;
    expect(Number(before) - Number(after)).toBe(50);
  });
});

test.describe("admin", () => {
  test.use({ storageState: authFile("admin") });

  test("a pack purchase costs exactly what was typed, and can be voided with a reason", async ({ page }) => {
    const a = await api("admin");
    const cup = (await a.get("/ingredients", { search: "Cup" })).data.find((i: { name: string }) => i.name.startsWith("Cup"));
    const qty = async () => (await a.get("/inventory/balances", { search: cup.name })).data.find((b: { ingredient_id: string }) => b.ingredient_id === cup.id).qty as string;
    const start = await qty();

    await page.goto("/admin/purchases/new");
    await page.getByLabel("Ingredients").first().selectOption({ value: cup.id });
    await page.getByLabel("Entry").first().selectOption("pack");
    await page.getByLabel("Packs").first().fill("10");
    await page.getByLabel("Pack size").first().fill("1000");
    await page.getByLabel("Cost per pack").first().fill("160.75");
    await expect(page.getByRole("cell", { name: "1607.50" })).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Post purchase" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Post \(cannot be undone\)/ }).click();
    await expect(page.getByText(/Stock and the expense were recorded once/)).toBeVisible();
    const id = page.url().split("/").pop()!;
    expect((await a.get(`/purchases/${id}`)).data.total).toBe("1607.50");
    expect(Number(await qty()) - Number(start)).toBe(10000);

    await page.getByRole("button", { name: "Void purchase" }).click();
    const dlg = page.getByRole("dialog", { name: "Void this purchase?" });
    await dlg.getByRole("button", { name: "Void purchase" }).click();
    await expect(dlg.getByText("Enter a reason.")).toBeVisible();
    await dlg.getByLabel("Reason").fill("Wrong invoice");
    await dlg.getByRole("button", { name: "Void purchase" }).click();
    await expect(page.getByText(/Voided .* Reason: “Wrong invoice”/)).toBeVisible();
    expect(await qty()).toBe(start);
  });

  test("money in & out and profit reports", async ({ page }) => {
    await page.goto("/admin/reports/money-in-out");
    await loaded(page);
    await expect(page.getByRole("cell", { name: "Money in" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Purchases from the drawer" })).toBeVisible();
    await expect(page.getByText("Cash drawers")).toBeVisible();
    await page.getByRole("link", { name: "Profit" }).click();
    await loaded(page);
    await expect(page.getByText("− Cost of what was sold", { exact: true })).toBeVisible();
    await expect(page.getByText("Out of every 100 sold")).toBeVisible();
    await expect(page.getByText(/Stock bought in this period/)).toBeVisible();
    await expect(page.getByText("Stock gains")).toHaveCount(0); // stock coming in is never profit (Sprint 5)
  });

  test("the Products screen shows the cost per serving", async ({ page }) => {
    await page.goto("/admin/products");
    await loaded(page);
    await page.locator(".pr-item", { hasText: "Iced Latte" }).click();
    await expect(page.getByText("Cost per serving")).toBeVisible();
  });

  for (const [lang, name] of [["en", "money-in-out"], ["ar", "money-in-out"], ["en", "profit"], ["ar", "profit"]] as const) {
    test(`screenshot ${lang} ${name}`, async ({ page }) => {
      await page.addInitScript((l) => localStorage.setItem("lang", l), lang);
      await page.goto(`/admin/reports/${name}`);
      await loaded(page);
      await page.screenshot({ path: `e2e/artifacts/screens/${lang}-desktop-${name}.png`, fullPage: true });
    });
  }
});
