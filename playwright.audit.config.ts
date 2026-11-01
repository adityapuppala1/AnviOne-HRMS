import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Separate project for the UI audit: `pnpm test:audit`.
// HEADED=1 opens a visible Chrome window; SLOWMO=250 slows each action.
const headed = process.env.HEADED === "1";
const slowMo = Number(process.env.SLOWMO ?? 0);
export default defineConfig({
  ...base,
  testDir: "./tests/e2e/audit",
  testIgnore: [],
  timeout: 20 * 60 * 1000,
  outputDir: "test-results/.audit-run",
  reporter: [["list"]],
  use: {
    ...base.use,
    screenshot: "off",
    trace: "off",
    headless: !headed,
    launchOptions: { slowMo },
  },
  projects: [
    {
      name: "audit",
      use: {
        ...devices["Desktop Chrome"],
        ...(headed ? { channel: "chrome" } : {}),
      },
    },
  ],
});
