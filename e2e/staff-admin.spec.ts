import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test.describe('Staff Admin', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    await page.waitForLoadState('networkidle');
  });

  test('should show Staff sidebar group for owner and navigate to each page', async ({ page }) => {
    const nav = page.locator('nav[aria-label="Main"]');
    await expect(nav.locator('text=Staff')).toBeVisible();

    await nav.locator('a:has-text("Directory")').click();
    await expect(page).toHaveURL(/\/staff-admin\/directory/);
    await expect(page.locator('h2:has-text("Household Staff")')).toBeVisible();

    await nav.locator('a:has-text("Timesheets")').click();
    await expect(page).toHaveURL(/\/staff-admin\/timesheets/);
    await expect(page.locator('h2:has-text("Staff Timesheets")')).toBeVisible();

    await nav.locator('a:has-text("Expenses")').click();
    await expect(page).toHaveURL(/\/staff-admin\/expenses/);
    await expect(page.locator('h2:has-text("Staff Expenses")')).toBeVisible();

    await nav.locator('a:has-text("Pay & Reports")').click();
    await expect(page).toHaveURL(/\/staff-admin\/pay/);
    await expect(page.locator('h2:has-text("Staff Pay")')).toBeVisible();
  });

  test('should not show a Staff tab in Settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('tab', { name: /^Staff$/ })).not.toBeVisible();
  });
});
