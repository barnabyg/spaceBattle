import { defineConfig, devices } from '@playwright/test';

// Override with E2E_PORT to run two checkouts side by side.
const port = Number(process.env.E2E_PORT ?? 5199);

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  // Stop at the first failure in CI only; local runs report every failure.
  maxFailures: process.env.CI ? 1 : 0,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'firefox-4k',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 3840, height: 2160 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
