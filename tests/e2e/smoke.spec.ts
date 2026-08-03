import { expect, test } from "@playwright/test";

test.describe("unauthenticated access", () => {
  test("redirects a protected route to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  });

  test("renders the login form with a username field, not email", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("rejects an unknown username without ever leaving the page", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="username"]').fill("no-such-user");
    await page.locator('input[type="password"]').fill("whatever123");
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login/);
  });
});
