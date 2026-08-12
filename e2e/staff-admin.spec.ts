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

    await nav.locator('a:has-text("Roster")').click();
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

  test('should add a staff member and allow editing their pay rate', async ({ page }) => {
    const nav = page.locator('nav[aria-label="Main"]');
    await nav.locator('a:has-text("Roster")').click();
    await expect(page).toHaveURL(/\/staff-admin\/directory/);

    const email = `st-${Date.now()}@example.com`;
    const today = new Date().toISOString().slice(0, 10);

    await page.getByLabel('First name').fill('Test');
    await page.getByLabel('Last name').fill('Nanny');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Employment start date').fill(today);
    await page.getByLabel('Hourly rate (USD)').pressSequentially('2000');
    await page.getByRole('button', { name: /Add staff member/ }).click();

    const row = page.locator('table tr', { hasText: email });
    await expect(row).toBeVisible();
    await expect(row).toContainText('20.00/hr');

    await row.getByText('Edit', { exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await modal.getByLabel('New hourly rate (USD)').pressSequentially('2250');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).not.toBeVisible();

    await expect(row).toContainText('22.50/hr');
  });
});
