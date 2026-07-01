/**
 * AC6 / AC6b — the security-critical rendering path, asserted through a real
 * browser against the real backend:
 *   - HTML mail renders inside an `iframe[sandbox=""]`;
 *   - the mail's `<script>` / `onerror` never execute;
 *   - the inline `cid:` image still renders (as a data: URI);
 *   - the remote tracker `<img>` KEEPS its URL server-side, but the out-of-band
 *     tracker receives ZERO hits when remote content is blocked (the default) —
 *     privacy is enforced by the iframe CSP (`img-src data:`), which blocks the
 *     network request, NOT by stripping the URL;
 *   - enabling "show remote images" loads them client-side (AC6b): the CSP
 *     widens to allow http(s), so the tracker is finally hit — client-side only,
 *     no server-side fetch.
 *
 * Note: `sanitize-html` strips `id` attributes, so images are located by their
 * allowed `alt` text.
 */
import { expect, test } from '@playwright/test';
import { TRACKER_ORIGIN } from '../helpers/env';
import {
  resetTracker,
  seedMail,
  setShowRemoteImages,
  trackerHits,
  type SeededMail,
} from '../helpers/portal';
import { mailFrame, openMailByToken } from '../helpers/ui';

test.describe.configure({ mode: 'serial' });

let mail: SeededMail;

test.beforeAll(async () => {
  mail = await seedMail({
    fromName: 'Trixie Tracker',
    subjectText: 'Rendering suite',
    trackerPixelUrl: `${TRACKER_ORIGIN}/px.gif`,
  });
});

test.afterAll(async () => {
  await setShowRemoteImages(false);
});

test('AC6/AC6b: sandboxed iframe, no script exec, inline cid renders, remote blocked by default', async ({
  page,
}) => {
  await setShowRemoteImages(false);
  await resetTracker();

  await page.goto('/');
  await openMailByToken(page, mail.token);

  // The reading pane is a fully-sandboxed iframe.
  const iframe = page.locator('iframe[sandbox=""]');
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('title', new RegExp(mail.token));
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');

  const frame = mailFrame(page);

  // AC6: the <script> was stripped server-side and could not run anyway.
  await expect(frame.locator('script')).toHaveCount(0);

  // AC6b: the inline cid image is delivered as a valid PNG data: URI. A
  // `sandbox=""` iframe disables in-frame JS, so we validate the image BYTES in
  // Node (decode the data URI, check the PNG signature) rather than reading
  // naturalWidth inside the frame. DOM-query locators still work in the frame.
  const inline = frame.locator('img[alt="inline logo"]');
  await expect(inline).toBeAttached();
  const inlineSrc = await inline.getAttribute('src');
  expect(inlineSrc).toMatch(/^data:image\/png;base64,/);
  const pngBytes = Buffer.from(inlineSrc!.split(',')[1] ?? '', 'base64');
  expect(pngBytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG magic

  // AC6b: the remote tracker <img> RETAINS its URL (privacy is enforced by the
  // iframe CSP, not by stripping the URL). The src is present in the DOM…
  const remote = frame.locator('img[alt="remote"]');
  expect(await remote.getAttribute('src')).toBe(`${TRACKER_ORIGIN}/px.gif`);

  // The "remote images blocked" privacy notice is shown.
  await expect(page.getByText('Remote images are blocked to protect your privacy.')).toBeVisible();

  // …but the CSP (`img-src data:`) blocks the fetch. Give any (forbidden)
  // network a chance, then prove ZERO tracker hits.
  await page.waitForTimeout(1500);
  const hits = await trackerHits();
  expect(hits.total, `tracker was hit: ${JSON.stringify(hits.hits)}`).toBe(0);
});

test('AC6b: enabling "show remote images" loads them client-side', async ({ page }) => {
  // The sanitizer preserves the remote <img> URL; enabling remote images widens
  // the iframe CSP to allow http(s), so the tracker is now fetched — client-side
  // only, no server-side fetch (AC6b).
  await resetTracker();
  await setShowRemoteImages(true);

  await page.goto('/');
  await openMailByToken(page, mail.token);

  // With remote images enabled the privacy notice should be gone.
  await expect(
    page.getByText('Remote images are blocked to protect your privacy.'),
  ).toHaveCount(0);

  // AC6b: the tracker should now receive exactly the pixel request, client-side.
  await expect.poll(async () => (await trackerHits()).total, { timeout: 5000 }).toBeGreaterThan(0);
});
