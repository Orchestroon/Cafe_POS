import { expect, test } from "@playwright/test";
import { PASSWORD } from "../helpers";

// No saved session here: these tests log in through the form.
test.describe("login", () => {
  test("an admin logs in and lands on the overview", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("a barista logs in and lands on the point of sale", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("barista2");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/pos$/);
  });

  test("a wrong password is refused with a clear message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Wrong username or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
