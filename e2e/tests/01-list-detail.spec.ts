/**
 * AC3 / AC4 — a seeded mail flows all the way through the real pipeline
 * (R2 PUT → ingest → DB → API → SPA) and appears in the list with the correct,
 * RFC2047-decoded From / To / Subject / date; opening it renders the detail.
 */
import { expect, test } from '@playwright/test';
import { TRACKER_ORIGIN } from '../helpers/env';
import { seedMail, type SeededMail } from '../helpers/portal';
import { openMailByToken, rowByToken } from '../helpers/ui';

let mail: SeededMail;

test.beforeAll(async () => {
  mail = await seedMail({
    fromName: 'Ada Lovelace',
    subjectText: 'Weekly report',
    trackerPixelUrl: `${TRACKER_ORIGIN}/px.gif`,
  });
});

test('AC3/AC4: seeded mail appears in the list with decoded From/To/Subject/date', async ({
  page,
}) => {
  await page.goto('/');

  const row = rowByToken(page, mail.token);
  await expect(row).toBeVisible();

  // From display name (parsed header) and the RFC2047-decoded subject (emoji).
  await expect(row).toContainText('Ada Lovelace');
  await expect(row).toContainText(mail.subjectDecoded); // "Weekly report 👋 <token>"
  // A date/time is rendered for the row.
  await expect(row.locator('time')).toHaveAttribute('datetime', /.+/);
});

test('AC4: detail shows subject, envelope recipient and sender', async ({ page }) => {
  await page.goto('/');
  await openMailByToken(page, mail.token);

  const article = page.getByRole('article', { name: 'Message' });
  await expect(article.getByRole('heading', { level: 1 })).toContainText(mail.subjectDecoded);
  // Envelope recipient (authoritative to_addr) is shown in the detail header.
  await expect(article).toContainText(`to ${mail.toAddr}`);
  await expect(article).toContainText(mail.fromAddr);
});
