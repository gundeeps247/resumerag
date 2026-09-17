import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests. They run the real app in Chromium, including in-browser
 * parsing, embedding and retrieval. No language model is required: without one, the
 * app answers in evidence-only mode, which still exercises retrieval and citations.
 *
 *   npx playwright install chromium   # once
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 300_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 180_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
