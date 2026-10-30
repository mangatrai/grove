import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

/**
 * #301 step 6 — per-line Bank deposit card. Relies on dev seed dev_0010 (split-deposit payslip, net $3,717.50 =
 * $3,217.50 to checking ···1001 + $500.00 to savings ···2002, both linked). Leaves the seed state as found.
 */
test.describe('Payslip split deposits', () => {
  test('shows both deposits linked; remove one, then link it manually', async ({ page }) => {
    await loginAsTestUser(page);
    // '/payslips' is proxied by Vite — navigate via sidebar so React Router handles it client-side.
    await page.getByRole('link', { name: 'Payslips' }).first().click();
    await page.getByRole('button').filter({ hasText: '3,717.50' }).first().click();

    const card = page.getByTestId('bank-deposit-card');
    const lines = card.getByTestId('deposit-line');
    await expect(lines).toHaveCount(2, { timeout: 15000 });
    await expect(lines.filter({ hasText: 'Linked' })).toHaveCount(2);
    await expect(card.getByText('Fully linked')).toBeVisible();

    const savingsLine = lines.filter({ hasText: '$500.00' });
    await savingsLine.getByRole('button', { name: 'Remove link' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();

    // The unlinked credit is still the best match for that line → suggested again.
    await expect(savingsLine.getByText('Suggested')).toBeVisible();
    await expect(card.getByText('$500.00 not linked')).toBeVisible();

    await savingsLine.getByRole('button', { name: 'Find deposit' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText(/For the/)).toBeVisible();
    const exact = modal.getByRole('row').filter({ hasText: 'Exact amount' });
    await expect(exact).toHaveCount(1);
    await exact.getByRole('button', { name: 'Link' }).click();

    await expect(savingsLine.getByText('Linked')).toBeVisible();
    await expect(card.getByText('Fully linked')).toBeVisible();
  });
});
