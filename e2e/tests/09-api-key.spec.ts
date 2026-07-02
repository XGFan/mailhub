/**
 * Client-side API key — a key saved in Settings (localStorage only) must ride
 * along as the `X-API-Key` header on every API request. Server-side enforcement
 * (401 without a key when API_KEYS is set) is covered by unit tests against the
 * Hono app; this spec pins the browser half of the contract. The key is scoped
 * to this test's browser context, so other specs are unaffected.
 */
import { expect, test } from '@playwright/test';
import { typeQuery } from '../helpers/ui';

test('a saved API key is sent as X-API-Key on subsequent API requests', async ({ page }) => {
  await page.goto('/');

  // Save a key in the settings dialog.
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Paste your API key').fill('e2e-test-key-123');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByText('Saved.')).toBeVisible();
  await page.keyboard.press('Escape');

  // A search triggers a fresh /api/mails request that must carry the header.
  // (The q value pins the request to the post-save search, not an earlier load.)
  const reqPromise = page.waitForRequest(
    (req) => req.url().includes('/api/mails') && req.url().includes('q=zzapikey'),
  );
  await typeQuery(page, 'zzapikey');
  const req = await reqPromise;
  expect(req.headers()['x-api-key']).toBe('e2e-test-key-123');
});
