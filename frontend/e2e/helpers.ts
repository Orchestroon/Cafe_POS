import { expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

export const PASSWORD = "Demo-pass-123";
export const ROLES = ["admin", "barista1", "barista2"] as const;
export type Role = (typeof ROLES)[number];
export const authFile = (u: Role) => new URL(`./.auth/${u}.json`, import.meta.url).pathname;
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";

/** A logged-in API client for test setup and for checking the server's truth. */
export async function api(user: Role) {
  const ctx = await request.newContext({ baseURL: BASE, storageState: authFile(user) });
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === "csrftoken")?.value ?? "";
  const h = (extra: Record<string, string> = {}) => ({ "X-CSRFToken": csrf, ...extra });
  const body = async (r: Awaited<ReturnType<APIRequestContext["get"]>>) => {
    const j = await r.json().catch(() => null);
    if (!r.ok()) throw new Error(`${r.url()} → ${r.status()} ${JSON.stringify(j)}`);
    return j;
  };
  return {
    ctx,
    get: async (path: string, params?: Record<string, string>) => body(await ctx.get(`/api/v1${path}`, { params })),
    post: async (path: string, data: unknown, key?: string) =>
      body(await ctx.post(`/api/v1${path}`, { data, headers: h(key ? { "Idempotency-Key": key } : {}) })),
    raw: ctx,
    headers: h,
  };
}
export type Api = Awaited<ReturnType<typeof api>>;

/** The demo catalogue: Iced Latte (Small 65 / Large 80 / XL 95), Oat Milk, Extra Shot, Syrup. */
export async function catalog(a: Api) {
  const products = (await a.get("/products")).data as { id: string; name: string; variants: { id: string; label: string }[]; modifier_groups: { name: string; options: { id: string; label: string }[] }[] }[];
  const latte = products.find((p) => p.name === "Iced Latte")!;
  const size = (l: string) => latte.variants.find((v) => v.label === l)!.id;
  const opt = (l: string) => latte.modifier_groups.flatMap((g) => g.options).find((o) => o.label === l)!.id;
  return { latte, size, opt };
}

/** Make sure `user` has an open shift (opening cash 300.00). Returns the shift id. */
export async function ensureShift(a: Api) {
  const cur = (await a.get("/shifts/current")).data;
  if (cur) return cur.id as string;
  return (await a.post("/shifts/open", { opening_cash: "300.00" })).data.id as string;
}

/** Make sure `user` has NO open shift (closes it with the expected cash). */
export async function ensureNoShift(a: Api) {
  const cur = (await a.get("/shifts/current")).data;
  if (cur) await a.post(`/shifts/${cur.id}/close`, { actual_closing_cash: cur.totals.expected_cash, note: "e2e reset" });
}

/** Sell one Small Iced Latte for cash through the API. Returns the checkout body. */
export async function sellSmallCash(a: Api) {
  const { size } = await catalog(a);
  return (await a.post("/orders/checkout", { items: [{ variant_id: size("Small"), quantity: 1, modifier_option_ids: [] }], payments: [{ method: "cash", amount: "65.00" }], expected_total: "65.00" }, randomUUID())).data;
}

export async function orderCount(a: Api) {
  return (await a.get("/orders", { page_size: "1" })).meta.total_count as number;
}

/** Page has no sideways scroll (responsive QA). */
export async function expectNoSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, "page scrolls sideways").toBeLessThanOrEqual(1);
}

/** Wait until no "Loading…" placeholder is left on the page (screenshots must show real content). */
export async function loaded(page: Page) {
  await expect(page.locator(".centered-state[role=status]")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
}
