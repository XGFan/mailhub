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
