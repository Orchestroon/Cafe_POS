import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { api, authFile, catalog, ensureShift, expectNoSideScroll, loaded } from "../helpers";

// Sprint 6 (owner, 2026-11-18): promotions. The Admin builds an offer on the Promotions tab, the
// Barista sells with it on /pos, the receipt and the server's records show it, and stock and
// cost are what they would be without it.
const TAG = `E2E ${randomUUID().slice(0, 5)}`;

const addSmall = async (page: Page) => {
  await page.getByRole("button", { name: /Iced Latte/ }).click();
  const sheet = page.getByRole("dialog", { name: "Iced Latte" });
  await sheet.getByRole("radio", { name: /Small/ }).click();
  await sheet.getByRole("button", { name: /Add to cart/ }).click();
};

async function switchOff(names: string[]) {
  const a = await api("admin");
  const list = (await a.get("/promotions", { page_size: "100" })).data as { id: string; name: string }[];
  for (const p of list.filter((x) => names.includes(x.name))) {
    const r = await a.raw.patch(`/api/v1/promotions/${p.id}`, { data: { is_active: false }, headers: a.headers() });
    expect(r.ok()).toBe(true);
  }
}

test.describe.serial("promotions", () => {
  const happy = `${TAG} Happy Hour`;
  const coupon = `${TAG} Coupon`;
  test.afterAll(async () => switchOff([happy, coupon])); // later specs sell at full price

  test("Admin creates an offer, sees the preview, and is warned when it sells below cost", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("admin") });
    const page = await ctx.newPage();
    await page.goto("/admin/promotions");
    await loaded(page);
    await expect(page.getByRole("tab", { name: "Promotions" })).toHaveClass(/active/);
    await expect(page.locator(".sidebar").getByRole("link", { name: "Menu & Recipes" })).toHaveClass(/active/);

    await page.getByRole("button", { name: /^\+ New/ }).click();
    const form = page.getByRole("dialog", { name: "New promotion" });
    await form.getByLabel("Name", { exact: true }).fill(happy);
    await form.getByLabel("Percent off").fill("20");
    await form.getByRole("checkbox", { name: /^Small/ }).first().check();
    await expect(form.getByText("20% off Iced Latte (Small)")).toBeVisible();
    await expect(form.getByText("Some prices drop below what the ingredients cost")).toHaveCount(0);

    await form.getByLabel("Percent off").fill("99");
    await expect(form.getByText("Some prices drop below what the ingredients cost")).toBeVisible();
    await expect(form.getByText(/Iced Latte \(Small\): 65\.00 EGP becomes 0\.65 EGP/)).toBeVisible();
    await form.getByLabel("Percent off").fill("20");
    await expect(form.getByText("Some prices drop below what the ingredients cost")).toHaveCount(0);

    // a field error from the server comes back on the field
    await form.getByLabel("Percent off").fill("120");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText(/can not be more than 100/)).toBeVisible();
    await form.getByLabel("Percent off").fill("20");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toBeHidden();
    const row = page.getByRole("row", { name: new RegExp(happy) });
    await expect(row).toContainText("20% off Iced Latte (Small)");
    await expect(row.locator(".badge")).toHaveText("Active");
    await ctx.close();
  });

  test("Barista sells with it: cart, receipt and the server's records; stock and cost are unchanged", async ({ browser }) => {
    const a = await api("admin");
    const { size } = await catalog(a);
    const b = await api("barista1");
    await ensureShift(b);
    const ctx = await browser.newContext({ storageState: authFile("barista1") });
    const page = await ctx.newPage();
    await page.goto("/pos");
    await addSmall(page);

    const cart = page.locator(".pos-cart");
    await expect(cart.locator(".cart-line-promo")).toContainText(`${happy} −13.00`);
    await expect(cart.locator(".cart-line-was")).toHaveText("65.00 EGP");
    await expect(cart.locator(".totals-promo")).toContainText("13.00");
    await expect(cart.locator(".totals-row.grand")).toContainText("52.00");

    await cart.getByRole("button", { name: /^Pay/ }).click();
    const pay = page.getByRole("dialog", { name: "Payment" });
    await expect(pay).toContainText("52.00");
    await pay.getByRole("button", { name: /Confirm payment/ }).click();
    await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible();
    await expect(page.locator(".pos-success")).toContainText(`${happy}`);
    const invoice = (await page.locator(".pos-success .mono").textContent())!.trim();

    const order = (await a.get("/orders", { invoice_no: invoice })).data[0];
    const detail = (await a.get(`/orders/${order.id}`)).data;
    expect(detail).toMatchObject({ subtotal: "65.00", discount_total: "13.00", total: "52.00" });
    expect(detail.promotions).toEqual([expect.objectContaining({ name: happy, amount: "13.00" })]);
    expect(detail.items[0]).toMatchObject({ line_discount: "13.00", line_total: "52.00" });
    // the same drink at full price used the same ingredients at the same cost
    const full = (await a.get(`/orders/${order.id}`)).data.items[0];
    expect(full.consumption.map((c: { ingredient_name: string; total_qty: string }) => `${c.ingredient_name}:${c.total_qty}`)).toContain("Coffee Beans:12.600");
    const q = (await b.post("/orders/quote", { items: [{ variant_id: size("Large"), quantity: 1, modifier_option_ids: [] }] })).data;
    expect(q.discount_total).toBe("0.00"); // the offer is for Small only

    await page.getByRole("button", { name: "Print receipt" }).click();
    const receipt = page.locator(".receipt");
    await expect(receipt).toContainText(happy);
    await expect(receipt).toContainText("-13.00");
    await expect(receipt).toContainText("52.00");

    // profit is after the discount, and the Promotions report shows it
    const profit = (await a.get("/reports/profit")).data;
    expect(Number(profit.promotion_discounts)).toBeGreaterThanOrEqual(13);
    const rep = (await a.get("/reports/promotions")).data;
    expect(rep.promotions.find((p: { name: string }) => p.name === happy)).toMatchObject({ orders_count: 1, discount_total: "13.00" });
    await ctx.close();
  });

  test("a tap-to-apply offer shows as a chip, and the best deal wins (no stacking)", async ({ browser }) => {
    const a = await api("admin");
    const { size } = await catalog(a);
    await a.post("/promotions", {
      name: coupon, kind: "discount", is_active: true, auto_apply: false, scope: "order", discount_type: "percentage", discount_value: "50.00",
      variant_ids: [], category_ids: [], combo_price: null, slots: [], starts_on: null, ends_on: null, days_of_week: [], window_start: null, window_end: null,
    });
    const b = await api("barista1");
    await ensureShift(b);
    const ctx = await browser.newContext({ storageState: authFile("barista1") });
    const page = await ctx.newPage();
    await page.goto("/pos");
    await addSmall(page);
    const cart = page.locator(".pos-cart");
    await expect(cart.locator(".totals-row.grand")).toContainText("52.00"); // Happy Hour only
    const chip = cart.getByRole("button", { name: new RegExp(coupon) });
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    // 50 % of 65.00 = 32.50 beats 13.00: the coupon replaces the Happy Hour, they never add up
    await expect(cart.locator(".totals-row.grand")).toContainText("32.50");
    await expect(cart.locator(".totals-promo")).toHaveCount(1);

    // the server agrees, and refuses a client that asks for the old total
    const q = (await b.post("/orders/quote", { items: [{ variant_id: size("Small"), quantity: 1, modifier_option_ids: [] }], promotion_ids: [] })).data;
    expect(q.total).toBe("52.00");
    const r = await b.raw.post("/api/v1/orders/checkout", {
      headers: b.headers({ "Idempotency-Key": randomUUID() }),
      data: { items: [{ variant_id: size("Small"), quantity: 1, modifier_option_ids: [] }], payments: [{ method: "cash", amount: "10.00" }], expected_total: "10.00" },
    });
    expect(r.status()).toBe(409);
    expect((await r.json()).error.code).toBe("PRICE_CHANGED");
    await chip.click(); // untap: back to the automatic offer, nothing is sold in this test
    await expect(cart.locator(".totals-row.grand")).toContainText("52.00");
    await ctx.close();
  });

  test("a phone shows the list and the form without sideways scroll", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("admin"), viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    await page.goto("/admin/promotions");
    await loaded(page);
    await expectNoSideScroll(page);
    await page.getByRole("button", { name: /^\+ New/ }).click();
    await expect(page.getByRole("dialog", { name: "New promotion" })).toBeVisible();
    await expectNoSideScroll(page);
    await ctx.close();
  });

  test("Arabic: the Promotions tab and form are translated and mirrored", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("admin") });
    const page = await ctx.newPage();
    await page.goto("/admin/promotions");
    await page.getByRole("button", { name: "عربي" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("tab", { name: "العروض والخصومات" })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(happy) })).toContainText("خصم 20% على");
    await page.getByRole("button", { name: /جديد/ }).click();
    await expect(page.getByRole("dialog", { name: "عرض جديد" })).toBeVisible();
    await expectNoSideScroll(page);
    await page.getByRole("button", { name: "إغلاق" }).click();
    await page.getByRole("button", { name: "EN" }).click();
    await ctx.close();
  });
});
