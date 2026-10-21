/**
 * Installable web app — the SPA ships a Web App Manifest + icons so it can be
 * installed (Chrome "Install", iOS "Add to Home Screen") and launch standalone.
 * Chromium's own manifest parser and installability check (via CDP) are the
 * oracle, so this fails on anything Chrome would actually reject — a wrong
 * Content-Type, an unreachable icon, a missing required field.
 */
import { expect, test } from '@playwright/test';

test('the manifest is served and Chromium accepts the app as installable', async ({
  page,
  request,
}) => {
  await page.goto('/');
  // Production sits behind cookie auth at the ingress (tinyauth); a
  // credential-less manifest fetch would get a login redirect. The e2e stack
  // has no ingress auth, so pin the attribute itself.
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'crossorigin',
    'use-credentials',
  );

  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/manifest+json');

  const cdp = await page.context().newCDPSession(page);
  // `manifest` is Chromium's parsed view (newer than the protocol typings).
  const { errors, manifest } = (await cdp.send('Page.getAppManifest')) as unknown as {
    errors: { message: string }[];
    manifest?: { name?: string; display?: string; icons?: { url: string }[] };
  };
  expect(errors).toEqual([]);
  expect(manifest?.name).toBe('MailHub');
  expect(manifest?.display).toMatch(/standalone/i); // Chromium reports it as "kStandalone"
  expect(manifest?.icons?.length).toBeGreaterThan(0);

  for (const icon of manifest?.icons ?? []) {
    const iconRes = await request.get(icon.url);
    expect(iconRes.status(), icon.url).toBe(200);
    expect(iconRes.headers()['content-type'], icon.url).toBe('image/png');
  }

  // Installability errors (besides the manifest) — e.g. icon not decodable.
  await expect
    .poll(async () => {
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      return installabilityErrors.map((e) => e.errorId);
    })
    .toEqual([]);
});

test('iOS home-screen icon and favicon are linked and served', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon.png',
  );
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');

  // Asserting content-type (not just 200) matters: the SPA fallback answers a
  // missing file with 200 + index.html.
  const apple = await request.get('/apple-touch-icon.png');
  expect(apple.status()).toBe(200);
  expect(apple.headers()['content-type']).toBe('image/png');

  const favicon = await request.get('/favicon.svg');
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()['content-type']).toBe('image/svg+xml');
});

test('theme-color follows the in-app theme toggle, not just the OS scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const themeColors = () =>
    page.locator('meta[name="theme-color"]').evaluateAll((els) =>
      els.map((el) => (el as HTMLMetaElement).content),
    );
  await expect.poll(themeColors).toEqual(['#ffffff', '#ffffff']);

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect.poll(themeColors).toEqual(['#0a0a0a', '#0a0a0a']);
});
