import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

/**
 * #301 — per-line Bank deposit card and the auto-link correction flow. Relies on dev seed dev_0010
 * (split-deposit payslip, net $3,717.50 = $3,217.50 to checking ···1001, linked by hand, + $500.00 to
 * savings ···2002, auto-linked). Needs a fresh `npm run db:reset:dev`: the run turns the auto link into a manual one.
 */
test.describe('Payslip split deposits', () => {
  test('remove a wrong auto link, then link the deposit by hand', async ({ page }) => {
    await loginAsTestUser(page);
    // '/payslips' is proxied by Vite — navigate via sidebar so React Router handles it client-side.
    await page.getByRole('link', { name: 'Payslips' }).first().click();
    await page.getByRole('button').filter({ hasText: '3,717.50' }).first().click();

    const card = page.getByTestId('bank-deposit-card');
    const lines = card.getByTestId('deposit-line');
    await expect(lines).toHaveCount(2, { timeout: 15000 });
    const checkingLine = lines.filter({ hasText: '$3,217.50' });
    const savingsLine = lines.filter({ hasText: '$500.00' });
    await expect(checkingLine.getByText('Linked', { exact: true })).toBeVisible();
    await expect(savingsLine.getByText('Auto-linked', { exact: true })).toBeVisible();
    await expect(card.getByText('Fully linked')).toBeVisible();

    await savingsLine.getByRole('button', { name: 'Remove link' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/won't be linked automatically again/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove' }).click();

    // A dismissed auto link is not offered again for this payslip.
    await expect(savingsLine.getByText('Not found', { exact: true })).toBeVisible();
    await expect(card.getByText('$500.00 not linked')).toBeVisible();

    await savingsLine.getByRole('button', { name: 'Find deposit' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText(/For the/)).toBeVisible();
    const exact = modal.getByRole('row').filter({ hasText: 'Exact amount' });
    await expect(exact).toHaveCount(1);
    await exact.getByRole('button', { name: 'Link' }).click();

    await expect(savingsLine.getByText('Linked', { exact: true })).toBeVisible();
    await expect(card.getByText('Fully linked')).toBeVisible();
  });
});
