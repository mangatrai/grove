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

  test.describe('Add transaction — CurrencyInput editing', () => {
    test.beforeEach(async ({ page }) => {
      await page.click('button:has-text("Add transaction")');
      await expect(page.getByRole('dialog', { name: 'Add transaction' })).toBeVisible();
    });

    test('typing digits into a blank field builds up the value cash-register style', async ({ page }) => {
      const amount = page.getByRole('dialog').getByRole('textbox', { name: 'Amount' });
      await amount.click();
      await amount.pressSequentially('12345');
      await expect(amount).toHaveValue('123.45');
    });

    test('selecting all and typing a digit replaces the value instead of appending', async ({ page }) => {
      const amount = page.getByRole('dialog').getByRole('textbox', { name: 'Amount' });
      await amount.click();
      await amount.pressSequentially('12345');
      await expect(amount).toHaveValue('123.45');

      await amount.selectText();
      await amount.press('7');
      await expect(amount).toHaveValue('0.07');
    });

    test('selecting all and pressing Backspace clears the whole value', async ({ page }) => {
      const amount = page.getByRole('dialog').getByRole('textbox', { name: 'Amount' });
      await amount.click();
      await amount.pressSequentially('7890');
      await expect(amount).toHaveValue('78.90');

      await amount.selectText();
      await amount.press('Backspace');
      await expect(amount).toHaveValue('');
    });
  });
});
