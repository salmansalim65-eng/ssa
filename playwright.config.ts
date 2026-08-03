import { defineConfig, devices } from "@playwright/test";

// e2e coverage here is a smoke test only: this sandbox has no provisioned
// Supabase project, so anything requiring real auth/data (the entire app
// past the login screen) can't be exercised end-to-end. What IS testable
// without a backend — proxy.ts's redirect-when-unauthenticated behavior and
// the login page itself — is covered in tests/e2e/smoke.spec.ts. A fuller
// e2e suite belongs in CI against a real Supabase project (see
// docs/06-deployment.md).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium",
        },
      },
    },
  ],
  webServer: {
    command: "npx next build && npx next start -p 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder",
      SUPABASE_SERVICE_ROLE_KEY: "placeholder",
    },
  },
});
