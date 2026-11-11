import { expect, test } from "@playwright/test";
import { api, authFile } from "../helpers";

test.use({ storageState: authFile("barista1") });

test("AT-19: a barista is blocked from admin pages and admin APIs, with no side effects", async ({ page }) => {
  for (const path of ["/admin/products", "/admin/audit", "/admin/settings", "/admin/reports/sales-summary"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "403" })).toBeVisible();
  }
  await expect(page.locator(".sidebar")).not.toContainText("Audit log");

  const b = await api("barista1");
  const a = await api("admin");
  const before = (await a.get("/categories", { page_size: "1" })).meta.total_count;
  for (const [method, path] of [["get", "/users"], ["get", "/audit-events"], ["get", "/reports/sales-summary"], ["post", "/categories"]] as const) {
    const r = method === "get" ? await b.raw.get(`/api/v1${path}`) : await b.raw.post(`/api/v1${path}`, { data: { name: "Hack" }, headers: b.headers() });
    expect(r.status(), `${method} ${path}`).toBe(403);
  }
  expect((await a.get("/categories", { page_size: "1" })).meta.total_count).toBe(before);
});
