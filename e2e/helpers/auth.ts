import { Page } from '@playwright/test';

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'e2e@example.com';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || 'ChangeMe123!';

export { TEST_USER_EMAIL, TEST_USER_PASSWORD };

/**
 * Logs in via the UI and waits for the dashboard to render.
 * Uses the dedicated e2e test user (force_password_change=false) so there
 * is no redirect to /reset-password.
 */
export async function loginAsTestUser(page: Page): Promise<void> {
  await page.goto('/');

  await page.fill('#home-email', TEST_USER_EMAIL);
  await page.fill('#home-password', TEST_USER_PASSWORD);
  await page.click('button[type="submit"]:has-text("Sign in")');

  // The URL stays at `/` but the login form unmounts when auth succeeds.
  // Wait for the email input to disappear as the indicator that we're logged in.
  await page.waitForSelector('#home-email', { state: 'hidden', timeout: 10000 });
}
