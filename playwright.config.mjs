import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "dot" : [["list"], ["html", { open: "never" }]],
  use: {
    // Browser tests must be local by default. Set E2E_BASE_URL explicitly for a remote smoke test.
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    // Use Playwright's managed browser by default. Set PLAYWRIGHT_CHANNEL=chrome
    // only when a local Chrome profile is explicitly desired.
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Avoid spawning ffmpeg during context cleanup on Windows; screenshots and traces remain.
    video: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
