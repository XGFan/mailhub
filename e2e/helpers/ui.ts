/**
 * Small DOM helpers shared by the specs. The header search controls are
 * rendered twice (an inline desktop copy and a stacked mobile copy, one hidden
 * by CSS), so we always target the `:visible` instance to avoid strict-mode
 * violations.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export type Field = 'All' | 'To' | 'From' | 'Subject';

/** The visible search input. */
export function searchBox(page: Page): Locator {
  return page.locator('input[aria-label="Search mail"]:visible');
}

/** Pick a search field (the visible toggle-group button). */
export async function selectField(page: Page, field: Field): Promise<void> {
  await page.locator(`button[aria-label="Search ${field}"]:visible`).click();
}

/** Type a query into the visible search box (debounced 300ms in the app). */
export async function typeQuery(page: Page, q: string): Promise<void> {
  const box = searchBox(page);
  await box.click();
  await box.fill(q);
}

/** All message-list rows (role=option). */
export function rows(page: Page): Locator {
  return page.getByRole('option');
}

/** The one row whose text contains `token` (tokens are unique per seeded mail). */
export function rowByToken(page: Page, token: string): Locator {
  return page.getByRole('option').filter({ hasText: token });
}

/** Open the seeded mail identified by `token` and wait for its detail to render. */
export async function openMailByToken(page: Page, token: string): Promise<void> {
  const row = rowByToken(page, token);
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('article', { name: 'Message' })).toBeVisible();
}

/** The sandboxed reading-pane iframe as a FrameLocator. */
export function mailFrame(page: Page) {
  return page.frameLocator('iframe[sandbox=""]');
}
