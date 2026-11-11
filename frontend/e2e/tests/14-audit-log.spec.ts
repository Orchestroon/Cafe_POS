import { expect, test, type Page } from "@playwright/test";
import { authFile, loaded } from "../helpers";

// Readable audit log (owner, 2026-11-11): sentences and labelled details, never JSON, technical
// action names or bare ids — in English and Arabic.
test.use({ storageState: authFile("admin") });
const TECHNICAL = /\b[a-z_]+\.(created|updated|replaced|posted|voided|opened|closed|adjusted|counted)\b|"[a-z_]+":|[0-9a-f]{8}-[0-9a-f]{4}-/;

async function expectNoTechnicalText(page: Page) {
  const text = await page.locator(".view-container").innerText();
  expect(text, "technical text on the audit page").not.toMatch(TECHNICAL);
}

test("the audit log reads as plain sentences and filters by what happened", async ({ page }) => {
  await page.goto("/admin/audit");
  await loaded(page);
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.locator(".audit-sentence").first()).not.toBeEmpty();
  await expectNoTechnicalText(page);

  await page.getByLabel("What happened").selectOption({ label: "Refund" });
  await expect(page).toHaveURL(/action=refund\.created/);
  const row = page.locator("tbody tr.clickable").first();
  await expect(row).toContainText("Refund");
  await expect(row).toContainText(/Refunded invoice POS-\d{7} .*Reason: “Customer changed mind”/);
  await row.click();
  const details = page.locator(".audit-details").first();
  await expect(details.locator("dt", { hasText: "Reason" })).toBeVisible();
  await expect(details).toContainText("Customer changed mind");
  await expect(details.locator("dt", { hasText: "Sold by" })).toBeVisible(); // a name, not an id
  await expectNoTechnicalText(page);
  await page.screenshot({ path: "e2e/artifacts/screens/en-desktop-audit.png", fullPage: true });

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
});

test("a changed price shows before → after", async ({ page }) => {
  await page.goto("/admin/audit");
  await page.getByLabel("What happened").selectOption({ label: "Size changed" });
  const row = page.locator("tbody tr.clickable").first();
  await expect(row).toContainText(/Track stock: Yes → No/); // from the recipe-guard flow
  await row.click();
  await expect(page.locator(".audit-before").first()).toHaveText("Yes");
  await expect(page.locator(".audit-after").first()).toHaveText("No");
});

test("History on an order opens the log filtered to that order", async ({ page }) => {
  await page.goto("/orders");
  await page.locator("tbody tr.clickable").first().click();
  const invoice = (await page.locator(".view-header h2").textContent())!.trim();
  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByText(`Showing the history of: ${invoice}`)).toBeVisible();
  await expect(page.locator("tbody tr.clickable").first()).toContainText("Sale");
  await page.getByRole("button", { name: "Show all" }).click();
  await expect(page.getByText(/Showing the history of/)).toBeHidden();
});

test("in Arabic every action, area and detail is translated", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lang", "ar"));
  await page.goto("/admin/audit");
  await loaded(page);
  await expect(page.getByRole("heading", { name: "سجل التدقيق" })).toBeVisible();
  const select = page.getByLabel("ما حدث");
  const groups = await select.locator("optgroup").evaluateAll((els) => els.map((e) => e.getAttribute("label")));
  expect(groups.length).toBeGreaterThan(0);
  for (const g of groups) expect(g).toMatch(/[؀-ۿ]/);
  const options = await select.locator("optgroup option").allTextContents();
  for (const o of options) expect(o, `untranslated action "${o}"`).toMatch(/[؀-ۿ]/);
  const badges = await page.locator(".audit-area").allTextContents();
  for (const b of badges) expect(b).toMatch(/[؀-ۿ]/);
  await page.locator("tbody tr.clickable").first().click();
  const labels = await page.locator(".audit-details dt").allTextContents();
  for (const l of labels) expect(l, `untranslated field "${l}"`).toMatch(/[؀-ۿ]/);
  await expectNoTechnicalText(page);
  await page.screenshot({ path: "e2e/artifacts/screens/ar-desktop-audit.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "e2e/artifacts/screens/ar-phone-audit.png", fullPage: true });
});
