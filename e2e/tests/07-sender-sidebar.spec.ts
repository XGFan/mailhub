/**
 * Sender enrichment + the collapsible sidebar.
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

test('the sidebar collapses and expands', async ({ page }) => {
  await page.goto('/');

  // Expanded by default (no persisted preference): the labelled nav is visible.
  const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
  await expect(collapse).toBeVisible();

  await collapse.click();

  // Collapsed: the toggle flips to "Expand sidebar".
  const expand = page.getByRole('button', { name: 'Expand sidebar' });
  await expect(expand).toBeVisible();

  await expand.click();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
});

test('the sidebar stays a compact icon rail on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  // Folder switch stays reachable (icon-only), but the collapse toggle is hidden
  // so an expanded rail can't eat the narrow screen.
  await expect(page.getByRole('button', { name: 'Starred', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveCount(0);

  // The rail is the ~56px (w-14) icon rail, not the 192px (w-48) expanded one.
  const box = await page.getByRole('complementary', { name: 'Folders' }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThan(80);
});
