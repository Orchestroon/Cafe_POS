import { expect, test } from "@playwright/test";
import { api, authFile, ensureNoShift, sellSmallCash } from "../helpers";

test.use({ storageState: authFile("barista2") });

test("AT-18: close a shift; expected, counted and difference are stored; C2 shows the last close", async ({ page }) => {
  const b = await api("barista2");
  await ensureNoShift(b);
  await b.post("/shifts/open", { opening_cash: "200.00" });
  await sellSmallCash(b); // +65 cash → expected 265.00

  await page.goto("/shift");
  await page.getByRole("button", { name: "Close shift" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Close shift" });
  await dlg.getByLabel("Counted cash").fill("260.00");
  await dlg.getByRole("button", { name: "Close shift" }).click();
  await expect(page.getByText(/Shortage/)).toBeVisible();

  const closed = (await (await api("admin")).get("/shifts", { status: "closed" })).data[0];
  expect([closed.expected_cash, closed.actual_cash, closed.difference]).toEqual(["265.00", "260.00", "-5.00"]);

  // C2: the open-shift popup now shows this close as information.
  await page.goto("/pos");
  await expect(page.getByRole("dialog", { name: "Open shift" }).getByText(/Your last shift closed on .* with .*260\.00.* counted/)).toBeVisible();
});
