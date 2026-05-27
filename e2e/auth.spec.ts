import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test.describe('Authentication', () => {
  test('should load homepage with login form when unauthenticated', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#home-email')).toBeVisible();
    await expect(page.locator('#home-password')).toBeVisible();
    await expect(page.locator('button[type="submit"]:has-text("Sign in")')).toBeVisible();
  });

  test('should show error message with invalid credentials', async ({ page }) => {
    await page.goto('/');

    await page.fill('#home-email', 'wrong@example.com');
    await page.fill('#home-password', 'wrongpassword');
    await page.click('button[type="submit"]:has-text("Sign in")');

    // Backend returns "Invalid credentials"; fallback is "Sign in failed. Check your credentials."
    await expect(page.locator('text=/Invalid credentials|Sign in failed/i')).toBeVisible();
  });

  test('should login successfully and hide the login form', async ({ page }) => {
    await loginAsTestUser(page);

    await expect(page.locator('#home-email')).not.toBeVisible();
  });

  test('should redirect force-password-change user to reset-password page', async ({ page }) => {
    // The bootstrap owner account has force_password_change=true
    await page.goto('/');
    await page.fill('#home-email', 'owner@example.com');
    await page.fill('#home-password', 'ChangeMe123!');
    await page.click('button[type="submit"]:has-text("Sign in")');

    // URL includes /reset-password with a ?token= query string — use regex not glob
    await page.waitForURL(/reset-password/, { timeout: 15000 });
    await expect(page).toHaveURL(/reset-password/);
  });
});
