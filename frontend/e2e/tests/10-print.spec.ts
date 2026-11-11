import { expect, test } from "@playwright/test";
import { api, authFile, ensureShift, sellSmallCash } from "../helpers";

// Print QA (spec 11): the receipt at 58 mm, 80 mm and A4. Checks the printed width fits the
// paper, the invoice number and totals are visible, and REPRINT shows only on a reprint.
// PDFs for the owner: e2e/artifacts/print/receipt-<width>.pdf
test.use({ storageState: authFile("barista1") });
const MM = 96 / 25.4; // CSS px per mm
// Printable width = paper minus the @page margins (thermal 2 mm each side, A4 12 mm each side).
const PAPER = { "58mm": 58 - 4, "80mm": 80 - 4, a4: 210 - 24 } as const;

let sale: { order_id: string; invoice_no: string };
test.beforeAll(async () => {
  const b = await api("barista1");
  await ensureShift(b);
  sale = await sellSmallCash(b);
});

for (const [width, mm] of Object.entries(PAPER)) {
  test(`receipt prints on ${width}`, async ({ page }) => {
    await page.addInitScript((w) => localStorage.setItem("receipt.width", w), width);
    await page.goto(`/orders/${sale.order_id}/receipt`);
    await page.emulateMedia({ media: "print" });
    const r = page.locator(".receipt");
    await expect(r).toHaveAttribute("data-width", width);
    await expect(r).toContainText(sale.invoice_no);
    await expect(r).toContainText("65.00");
    await expect(r).not.toContainText("REPRINT");
    await expect(page.locator(".receipt-toolbar")).toBeHidden(); // no buttons on paper
    const box = (await r.boundingBox())!;
    expect(box.width, "receipt wider than the paper").toBeLessThanOrEqual(mm * MM + 1);
    // Nothing inside the receipt sticks out of it (long names wrap).
    const overflow = await r.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.pdf({ path: `e2e/artifacts/print/receipt-${width}.pdf`, preferCSSPageSize: true, printBackground: true });
  });
}

test("a reprint is marked REPRINT", async ({ page }) => {
  await page.goto(`/orders/${sale.order_id}/receipt?reprint=1`);
  await expect(page.locator(".receipt")).toContainText("REPRINT");
});
