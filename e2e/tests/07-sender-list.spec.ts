/**
 * Sender enrichment + the collapsible / resizable mail list.
 *
 * Sender: a mail whose SMTP envelope sender (an opaque bounce / return-path
 * address) differs from its header `From:` must be DISPLAYED by the human-
 * meaningful header From — not the bounce address — with the envelope surfaced
 * separately as the Return-Path. This is the regression the portal previously had
 * (it showed the envelope sender).
 */
import { expect, test } from '@playwright/test';
import { makeSampleEml } from '../fixtures/make-eml';
import { searchMails, waitForMailByToken } from '../helpers/portal';
import { putInboxObject } from '../helpers/s3';
import { openMailByToken, rowByToken } from '../helpers/ui';

test('displays the header From, not the envelope bounce address', async ({ page }) => {
  const token = `snd${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const headerFrom = `real-${token}@example.com`;
  const envelopeFrom = `0100019f-bounce-${token}@send.mail.example.com`;
  const toAddr = `recipient-${token}@mailhub.test`;

  const built = makeSampleEml({
    token,
    fromAddr: headerFrom,
    fromName: 'Real Sender',
    toAddr,
    subjectText: 'Sender enrichment',
  });
  // Envelope `from` (R2 metadata) is the bounce address — different from the header.
  await putInboxObject(built.raw, { to: toAddr, from: envelopeFrom });
  await waitForMailByToken(token);

  // API contract: fromAddr is the header From, never the bounce address.
  const res = await searchMails({ q: token, includeSpam: 'true' });
  const hit = res.items.find((m) => m.subject.includes(token));
  expect(hit).toBeTruthy();
  expect(hit!.fromAddr).toBe(headerFrom);
  expect(hit!.fromName).toBe('Real Sender');
  expect(hit!.fromAddr).not.toContain('bounce');

  await page.goto('/');

  // The row shows the display name, not the opaque envelope address.
  const row = rowByToken(page, token);
  await expect(row).toContainText('Real Sender');
  await expect(row).not.toContainText(envelopeFrom);

  // The detail shows the real From and surfaces the envelope as the Return-Path.
  await openMailByToken(page, token);
  const article = page.getByRole('article', { name: 'Message' });
  await expect(article).toContainText(headerFrom);
  await expect(article).toContainText(`Return-Path: ${envelopeFrom}`);
});

test('the message list collapses and expands (desktop)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const list = page.locator('section[aria-label="Message list"]');

  // Expanded by default (no persisted preference): the list and its collapse
  // control are visible.
  const collapse = page.getByRole('button', { name: 'Collapse list' });
  await expect(collapse).toBeVisible();
  await expect(list).toBeVisible();

  await collapse.click();

  // Collapsed: the list is hidden and a slim rail exposes the expand control.
  const expand = page.getByRole('button', { name: 'Expand list' });
  await expect(expand).toBeVisible();
  await expect(list).toBeHidden();

  await expand.click();
  await expect(page.getByRole('button', { name: 'Collapse list' })).toBeVisible();
  await expect(list).toBeVisible();
});

test('the list is resizable via the separator (desktop)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const list = page.locator('section[aria-label="Message list"]');
  const separator = page.getByRole('separator', { name: 'Resize message list' });
  await expect(separator).toBeVisible();

  const before = (await list.boundingBox())!.width;
  // Keyboard nudges are the deterministic path (arrow keys widen the column).
  await separator.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  const after = (await list.boundingBox())!.width;
  expect(after).toBeGreaterThan(before);
});

test('the list has no collapse/resize affordances on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  // Single-pane on a phone: no collapse toggle and no resize separator, but the
  // list toolbar (Filter) is still reachable.
  await expect(page.getByRole('button', { name: 'Collapse list' })).toHaveCount(0);
  await expect(page.getByRole('separator', { name: 'Resize message list' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Filter' })).toBeVisible();
});
