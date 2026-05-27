import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test.describe('ESPP Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    // '/espp' is proxied by Vite — navigate via sidebar so React Router handles it client-side.
    await page.getByRole('link', { name: 'ESPP' }).click();
    await expect(page.getByRole('heading', { name: 'ESPP', level: 2 })).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle');
  });

  test('should display year summary strip and purchase batches section', async ({ page }) => {
    await expect(page.getByText(/Company Stock \(ESPP\)/)).toBeVisible();
    await expect(page.getByText('Shares Purchased YTD')).toBeVisible();
    await expect(page.getByText('Purchase Batches')).toBeVisible();
    await expect(page.getByText(/batches · click a row to expand sale history/)).toBeVisible();
  });

  test('should show empty state or batch table when dev data is absent or present', async ({ page }) => {
    const empty = page.getByText(/No ESPP batches yet/i);
    const table = page.locator('table').filter({ has: page.getByText('Purchase Date') });
    await expect(empty.or(table)).toBeVisible();
  });

  test('should disable Record Sale when no shares are held', async ({ page }) => {
    const recordSale = page.getByRole('button', { name: 'Record Sale' });
    const hasBatches = await page.locator('table tbody tr').count();
    if (hasBatches === 0) {
      await expect(recordSale).toBeDisabled();
    } else {
      // If seeded batches exist, button state depends on held > 0 — at least verify it renders.
      await expect(recordSale).toBeVisible();
    }
  });

  test('should open and close Import modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByText('Import ESPP Data')).toBeVisible();
    await expect(page.getByText('Purchase PDF')).toBeVisible();
    await expect(page.getByText('Allocation CSV')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import' }).last()).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Import ESPP Data')).not.toBeVisible();
  });

  test('should change year via year selector', async ({ page }) => {
    const yearPill = page.locator('text=/^\\d{4}$/').first();
    const initialYear = await yearPill.textContent();
    expect(initialYear).toMatch(/^\d{4}$/);

    const prevBtn = page.getByRole('button', { name: 'Previous year' });
    if (await prevBtn.isEnabled()) {
      await prevBtn.click();
      await page.waitForLoadState('networkidle');
      const prevYear = Number(initialYear) - 1;
      await expect(page.getByText(`Company Stock (ESPP) · ${prevYear} year summary`)).toBeVisible();
    }
  });

  test('should not have console errors on ESPP page load', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.getByRole('link', { name: 'ESPP' }).click();
    await expect(page.getByRole('heading', { name: 'ESPP', level: 2 })).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    expect(consoleErrors).toHaveLength(0);
  });
});
