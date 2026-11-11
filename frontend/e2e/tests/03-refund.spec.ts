import { expect, test } from "@playwright/test";
import { api, authFile, ensureShift, sellSmallCash } from "../helpers";

test.use({ storageState: authFile("barista1") });

test("AT-14: a barista refunds a cash order with a reason; the invoice stays", async ({ page }) => {
  const b = await api("barista1");
  await ensureShift(b);
  const sale = await sellSmallCash(b);

  await page.goto(`/orders/${sale.order_id}`);
  await page.getByRole("button", { name: "Refund" }).click();
  const dlg = page.getByRole("dialog", { name: new RegExp(`Refund ${sale.invoice_no}`) });
  await dlg.getByRole("button", { name: "Refund in full" }).click();
  await expect(dlg.getByText(/at least 3 characters/)).toBeVisible(); // reason is mandatory
  await dlg.getByLabel("Reason").fill("Customer changed mind");
  await dlg.getByRole("button", { name: "Refund in full" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText("Refunded").first()).toBeVisible();

  const a = await api("admin");
  const detail = (await a.get(`/orders/${sale.order_id}`)).data;
  expect(detail.status).toBe("refunded");
  expect(detail.invoice_no).toBe(sale.invoice_no);
  expect(detail.refund.reason).toBe("Customer changed mind");
  expect(detail.refund.lines).toEqual([{ method: "cash", amount: "65.00", external_reference: "" }]);
  // AT-15: a second refund is refused by the server.
  const again = await b.raw.post(`/api/v1/orders/${sale.order_id}/refunds`, {
    data: { reason: "again", confirm_amount: "65.00" },
    headers: b.headers({ "Idempotency-Key": crypto.randomUUID() }),
  });
  expect(again.status()).toBe(409);
});
