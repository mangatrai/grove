import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    // Already on '/' after login — dashboard renders here
    await page.waitForLoadState('networkidle');
  });

  test('should load dashboard and hide login form', async ({ page }) => {
    await expect(page.locator('#home-email')).not.toBeVisible();
  });

  test('should display spending section', async ({ page }) => {
    // Heading text is "Where money went · this month" (CSS may uppercase it visually)
    await expect(page.locator('text=/Where money went/i')).toBeVisible();
  });

  test('should display net worth section', async ({ page }) => {
    await expect(page.locator('text=/Net Worth/i').first()).toBeVisible();
  });

  test('should display budget prompt or budget data', async ({ page }) => {
    // Either a budget is set ("Budget") or the no-budget prompt is shown
    await expect(
      page.locator('text=/No budget set for this month|Budget/i').first()
    ).toBeVisible();
  });

  test('should not have console errors on dashboard load', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Re-trigger load so the listener is active
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    expect(consoleErrors).toHaveLength(0);
  });
});
