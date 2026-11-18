import { expect, test } from "@playwright/test";
import { api, authFile, ensureShift, sellSmallCash } from "../helpers";

// Step 2: a Barista runs the whole shift from /pos; an Admin gets /pos without the sidebar.
test.describe("barista", () => {
  test.use({ storageState: authFile("barista1") });

  test("no sidebar, /shift redirects, and the three panels work without leaving /pos", async ({ page }) => {
    const b = await api("barista1");
    await ensureShift(b);
    const sale = await sellSmallCash(b);

    await page.goto("/shift");
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await expect(page.locator(".mobile-bottom-nav")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

    // Orders / Refund: find the invoice, refund it with a reason.
    await page.getByRole("button", { name: /Orders \/ Refund/ }).click();
    const orders = page.getByRole("dialog", { name: "Orders / Refund" });
    await orders.getByLabel("Invoice number").fill(sale.invoice_no);
    await orders.getByRole("button", { name: new RegExp(sale.invoice_no) }).click();
    await expect(orders.getByRole("link", { name: "Reprint receipt" })).toBeVisible();
    await orders.getByRole("button", { name: "Refund", exact: true }).click();
    const refund = page.getByRole("dialog", { name: new RegExp(`Refund ${sale.invoice_no}`) });
    await refund.getByLabel("Reason").fill("Wrong drink");
    await refund.getByRole("button", { name: "Refund in full" }).click();
    await expect(refund).toBeHidden();
    await expect(orders.locator(".badge", { hasText: "Refunded" }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/pos$/);

    // Pay from drawer: only the drawer, listed under this shift.
    await page.getByRole("button", { name: "Pay from drawer" }).click();
    const pay = page.getByRole("dialog", { name: "Pay from drawer" }).first();
    await pay.getByRole("button", { name: "Pay from drawer" }).click();
    const form = page.getByRole("dialog", { name: "Pay from drawer" }).last();
    await expect(form.getByText("External")).toHaveCount(0);
    await form.getByLabel("Description").fill("Ice bags step2");
    await form.getByLabel("Amount").fill("12.00");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("cell", { name: /Ice bags step2/ })).toBeVisible();
    const cur = (await b.get("/shifts/current")).data;
    const mine = (await b.get("/expenses", { shift_id: cur.id })).data;
    expect(mine.map((e: { description: string }) => e.description)).toContain("Ice bags step2");
    await page.keyboard.press("Escape");

    // Shift & Close shows the summary with the drawer expense.
    await page.getByRole("button", { name: /Shift & Close/ }).click();
    const shift = page.getByRole("dialog", { name: "Shift & Close" });
    await expect(shift.getByText("Expected cash")).toBeVisible();
    await expect(shift.getByText("Drawer expenses")).toBeVisible();
    await expect(shift.getByRole("button", { name: "Cash out / in" })).toBeVisible();
  });
});

test.describe("admin", () => {
  test.use({ storageState: authFile("admin") });

  test("/pos hides the sidebar and has a way back to the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".sidebar")).toBeVisible();
    await page.goto("/pos");
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await page.getByRole("button", { name: "Back to dashboard" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".sidebar")).toBeVisible();
  });
});
