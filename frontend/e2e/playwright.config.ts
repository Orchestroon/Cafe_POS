import { defineConfig, devices } from "@playwright/test";

// Sprint 4 E2E (spec 11, AT-19, AT-20). Runs against the isolated e2e stack:
//   docker compose -f docker-compose.e2e.yml run --rm e2e
// Tests share one seeded database, so they run one at a time, in file order.
export default defineConfig({
  testDir: "./tests",
  outputDir: "./artifacts/results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./global-setup.ts",
  reporter: [["list"], ["html", { outputFolder: "./artifacts/report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    locale: "en-US",
    timezoneId: "Africa/Cairo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
});
