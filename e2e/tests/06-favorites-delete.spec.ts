/**
 * Favorites (star / unstar + the Starred folder) and delete.
 *
 * Drives the real UI: star a mail from the reading pane, confirm it shows up in
 * the sidebar's Starred view, unstar it (it leaves the view), then delete a mail
 * through the confirm dialog and confirm it's gone from the list.
 */
import { expect, test } from '@playwright/test';
import { seedMail } from '../helpers/portal';
import { openMailByToken, rowByToken } from '../helpers/ui';

test('star from the reading pane, appears under Starred, unstar removes it', async ({ page }) => {
  const mail = await seedMail({ subjectText: 'Favorite one' });
  await page.goto('/');
  await openMailByToken(page, mail.token);

  const article = page.getByRole('article', { name: 'Message' });

  // Star it from the detail header.
  await article.getByRole('button', { name: 'Star', exact: true }).click();
  await expect(article.getByRole('button', { name: 'Unstar', exact: true })).toBeVisible();

  // The Starred folder now lists this mail.
  await page.getByRole('button', { name: 'Starred', exact: true }).click();
  await expect(rowByToken(page, mail.token)).toBeVisible();

  // Unstarring drops it back out of the Starred view.
  await article.getByRole('button', { name: 'Unstar', exact: true }).click();
  await expect(rowByToken(page, mail.token)).toHaveCount(0);

  // Back in the Inbox it's still present (only unstarred).
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  await expect(rowByToken(page, mail.token)).toBeVisible();
});

test('delete removes the mail (and its detail) after confirmation', async ({ page }) => {
  const mail = await seedMail({ subjectText: 'Delete me' });
  await page.goto('/');
  await openMailByToken(page, mail.token);

  const article = page.getByRole('article', { name: 'Message' });
  await article.getByRole('button', { name: 'Delete message' }).click();

  // Confirm dialog.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Delete this message?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

  // Gone from the list, and the reading pane falls back to its placeholder.
  await expect(rowByToken(page, mail.token)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No message selected' })).toBeVisible();
});
