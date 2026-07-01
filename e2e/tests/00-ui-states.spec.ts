/**
 * AC12 — designed UI states. This file runs FIRST (before any mail is seeded)
 * so the empty-inbox assertion sees a genuinely empty store. Loading and error
 * states are induced with request interception, so they never touch the DB.
 */
import { expect, test } from '@playwright/test';
import { truncateMails } from '../helpers/db';

test.describe.configure({ mode: 'serial' });

test('AC12: empty inbox renders the designed empty state', async ({ page }) => {
  // Guarantee an empty store even on a reused stack.
  await truncateMails();

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Your inbox is empty' })).toBeVisible();
  // The two-pane shell is present; the reading pane shows its placeholder.
  await expect(page.getByRole('region', { name: 'Message list' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No message selected' })).toBeVisible();
});

test('AC12: loading skeleton shows while the list request is in flight', async ({ page }) => {
  // Delay the list response so the loading state is observable.
  await page.route('**/api/mails*', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });

  await page.goto('/');

  await expect(page.getByText('Loading', { exact: false })).toBeVisible();
  // After the delayed (empty) response resolves, it settles into empty-inbox.
  await expect(page.getByRole('heading', { name: 'Your inbox is empty' })).toBeVisible();
});

test('AC12: API error renders the designed error state with retry', async ({ page }) => {
  await page.route('**/api/mails*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
  );

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
