import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test.describe('Transactions Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    // '/transactions' is proxied by Vite to the backend — navigate via sidebar click
    // so React Router handles it client-side without a full HTTP request.
    await page.click('text=Transactions');
    await page.waitForLoadState('networkidle');
  });

  test('should display a table', async ({ page }) => {
    await expect(page.locator('table')).toBeVisible();
  });

  test('should display a search or filter input', async ({ page }) => {
    await expect(page.locator('input').first()).toBeVisible();
  });

  test('should display at least one transaction row when dev seeds are loaded', async ({ page }) => {
    await expect(page.locator('table tbody tr').first()).toBeVisible();
  });

  test('should show Needs review tab and switch to it', async ({ page }) => {
    // Tab is a Button with role="tab" containing text "Needs review"
    const reviewTab = page.locator('button[role="tab"]:has-text("Needs review")');
    await expect(reviewTab).toBeVisible();
    await reviewTab.click();
    // After switching, the tab should be active (aria-selected=true)
    await expect(reviewTab).toHaveAttribute('aria-selected', 'true');
  });
});
