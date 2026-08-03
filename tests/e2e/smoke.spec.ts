import { expect, test } from "@playwright/test";

test.describe("unauthenticated access", () => {
  test("redirects a protected route to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  });

  test("renders the login form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("rejects an invalid email without ever leaving the page", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("not-an-email");
    await page.locator('input[type="password"]').fill("whatever123");
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login/);
  });
});
