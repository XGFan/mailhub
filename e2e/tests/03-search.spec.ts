/**
 * AC5 / AC12 — search by recipient, sender and subject (case-insensitive
 * substrings), plus the zero-results state. The seeded mail's unique token is
 * embedded in its To, From and Subject so each field search matches exactly it.
 */
import { expect, test } from '@playwright/test';
import { seedMail, type SeededMail } from '../helpers/portal';
import { rows, selectField, typeQuery } from '../helpers/ui';

let mail: SeededMail;

test.beforeAll(async () => {
  mail = await seedMail({ fromName: 'Grace Hopper', subjectText: 'Invoice' });
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('AC5: search by recipient (To), case-insensitive', async ({ page }) => {
  await selectField(page, 'To');
  await typeQuery(page, `RECIPIENT-${mail.token}`.toUpperCase());
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(mail.token);
});

test('AC5: search by sender (From), case-insensitive', async ({ page }) => {
  await selectField(page, 'From');
  await typeQuery(page, `SENDER-${mail.token}`.toUpperCase());
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Grace Hopper');
});

test('AC5: search by subject (Subject), case-insensitive', async ({ page }) => {
  await selectField(page, 'Subject');
  await typeQuery(page, mail.token.toUpperCase());
  await expect(rows(page)).toHaveCount(1);
  // The emoji (not the search term) proves the RFC2047 subject decode.
  await expect(rows(page).first()).toContainText('👋');
});

test('AC12: a query matching nothing renders the no-results state', async ({ page }) => {
  await selectField(page, 'All');
  await typeQuery(page, `no-such-mail-${mail.token}-zzz`);
  await expect(page.getByRole('heading', { name: 'No messages found' })).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
});

test('sort toggles the list order (newest ⇄ oldest)', async ({ page }) => {
  // Two mails sharing a subject tag; header Date is identical, so ordering is
  // decided by received_at — the later-seeded mail is the "newer" one.
  const tag = `sortgrp${Date.now().toString(36)}`;
  const older = await seedMail({ subjectText: `Sortcase ${tag} older` });
  const newer = await seedMail({ subjectText: `Sortcase ${tag} newer` });

  await page.goto('/');
  await selectField(page, 'Subject');
  await typeQuery(page, tag);
  await expect(rows(page)).toHaveCount(2);

  // Default = newest first: the later-seeded mail is on top.
  await expect(rows(page).first()).toContainText(newer.token);

  // Oldest first flips the order (this is the path that was broken on page 1
  // until the sort dependency was added to the fetch effect).
  await page.getByRole('button', { name: 'Sort' }).click();
  await page.getByRole('menuitemradio', { name: 'Oldest first' }).click();
  await expect(rows(page).first()).toContainText(older.token);

  // Back to newest first.
  await page.getByRole('button', { name: 'Sort' }).click();
  await page.getByRole('menuitemradio', { name: 'Newest first' }).click();
  await expect(rows(page).first()).toContainText(newer.token);
});
