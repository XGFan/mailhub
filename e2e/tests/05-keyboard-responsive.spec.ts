/**
 * AC13 — keyboard navigation (↑/↓ move the active row, Enter opens it) and the
 * responsive layout (two-pane ≥1024px; single-pane <1024px with a Back button).
 * Two mails are seeded so arrow movement is observable.
 */
import { expect, test } from '@playwright/test';
import { seedMail } from '../helpers/portal';
import { rows } from '../helpers/ui';

test.beforeAll(async () => {
  await seedMail({ subjectText: 'Keyboard one' });
  await seedMail({ subjectText: 'Keyboard two' });
});

test('AC13: ↑/↓ move the active row and Enter opens it', async ({ page }) => {
  await page.goto('/');

  const listbox = page.locator('[role="listbox"]');
  await expect(listbox).toBeVisible();

  const id0 = await rows(page).nth(0).getAttribute('id');
  const id1 = await rows(page).nth(1).getAttribute('id');
  expect(id0).toBeTruthy();
  expect(id1).toBeTruthy();

  await listbox.focus();
  // Starts on the first row.
  await expect(listbox).toHaveAttribute('aria-activedescendant', id0!);

  // ↓ moves the active descendant to the second row, Enter opens it.
  await page.keyboard.press('ArrowDown');
  await expect(listbox).toHaveAttribute('aria-activedescendant', id1!);
  await page.keyboard.press('Enter');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('article', { name: 'Message' })).toBeVisible();

  // ↑ moves back to the first row, Enter opens that one.
  await listbox.focus();
  await page.keyboard.press('ArrowUp');
  await expect(listbox).toHaveAttribute('aria-activedescendant', id0!);
  await page.keyboard.press('Enter');
  await expect(rows(page).nth(0)).toHaveAttribute('aria-selected', 'true');
});

test('AC13: two-pane layout on desktop (≥1024px)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await expect(page.locator('section[aria-label="Message list"]')).toBeVisible();
  await expect(page.locator('section[aria-label="Reading pane"]')).toBeVisible();
});

test('AC13: single-pane with Back on mobile (<1024px)', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto('/');

  const list = page.locator('section[aria-label="Message list"]');
  const reading = page.locator('section[aria-label="Reading pane"]');

  // Only the list is shown initially.
  await expect(list).toBeVisible();
  await expect(reading).not.toBeVisible();

  // Opening a mail swaps to the reading pane with a Back control.
  await rows(page).first().click();
  await expect(reading).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(list).not.toBeVisible();

  // Back returns to the list.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(list).toBeVisible();
});
