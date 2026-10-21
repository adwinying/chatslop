import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm seed && pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // convex dev stops its backend and vite on SIGINT; a hard kill orphans them.
    gracefulShutdown: { signal: "SIGINT", timeout: 15_000 },
  },
});
