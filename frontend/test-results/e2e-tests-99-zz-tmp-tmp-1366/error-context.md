# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/tests/99-zz-tmp.spec.ts >> tmp 1366
- Location: e2e/tests/99-zz-tmp.spec.ts:5:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/admin/reports/money-in-out", waiting until "load"

```

# Test source

```ts
  1  | import { test } from "@playwright/test";
  2  | import { authFile, loaded } from "../helpers";
  3  | test.use({ storageState: authFile("admin") });
  4  | for (const [w, h] of [[1920, 1080], [1366, 768]] as const) {
  5  |   test(`tmp ${w}`, async ({ page }) => {
  6  |     await page.setViewportSize({ width: w, height: h });
  7  |     for (const p of ["reports/money-in-out", "products", ""]) {
> 8  |       await page.goto(`/admin/${p}`); await loaded(page);
     |                  ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  9  |       await page.screenshot({ path: `e2e/artifacts/tmp-${w}-${p.replace(/\W/g, "_") || "home"}.png` });
  10 |     }
  11 |   });
  12 | }
  13 | 
```