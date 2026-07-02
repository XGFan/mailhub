/**
 * Block (拒收) rules — the full pipeline: create a rule from the UI (row menu,
 * reading pane, settings form), then prove matching mail is dropped at ingest
 * (never archived) while non-matching mail still arrives, and that removing the
 * rule lets the sender through again.
 *
 * Seeding a mail that is EXPECTED to be dropped cannot use `seedMail` (it polls
 * until the mail appears and would throw). Instead we `putInboxObject` the raw
 * message directly, then seed a normal CONTROL mail afterwards: R2 keys are
 * epoch-prefixed and a pass drains the whole listing in order, so once the
 * control (put later) has been ingested, the blocked object (put earlier) has
 * necessarily been processed — at that point "absent from search" is
 * deterministic, not a race.
 */
import { expect, test, type Page } from '@playwright/test';
import { makeSampleEml } from '../fixtures/make-eml';
import { runIngest, searchMails, seedMail } from '../helpers/portal';
import { putInboxObject } from '../helpers/s3';
import { openMailByToken, rowByToken } from '../helpers/ui';

/** A fresh unique token (same shape the seed helper uses). */
function freshToken(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/** Drop a raw mail into inbox/ without waiting for it to appear. */
async function putMailDirect(token: string, fromAddr: string): Promise<void> {
  const toAddr = `recipient-${token}@mailhub.test`;
  const built = makeSampleEml({
    token,
    toAddr,
    fromAddr,
    fromName: 'Blocked Sender',
    subjectText: 'Should be dropped',
  });
  await putInboxObject(built.raw, { to: toAddr, from: fromAddr });
  await runIngest();
}

/** Assert the token never made it into the archive (spam included). */
async function expectAbsent(token: string): Promise<void> {
  const res = await searchMails({ q: token, field: 'all', includeSpam: 'true' });
  expect(res.items.filter((m) => m.subject.includes(token))).toHaveLength(0);
}

/** Open the settings dialog and return its locator. */
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Blocked senders')).toBeVisible();
  return dialog;
}

test('address rule from the row menu drops future mail; removing it lets mail through', async ({
  page,
}) => {
  const first = await seedMail({ subjectText: 'Block address base' });
  await page.goto('/');

  // Block the sender from the row's overflow menu.
  const row = rowByToken(page, first.token);
  await row.hover();
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Block sender' }).click();
  await expect(page.getByText(`Blocked ${first.fromAddr}`)).toBeVisible();

  // A second mail from the same sender is dropped at ingest: put it directly,
  // then sync on a control mail seeded afterwards.
  const blockedToken = freshToken('blk');
  await putMailDirect(blockedToken, first.fromAddr);
  await seedMail({ subjectText: 'Control after address block' });
  await expectAbsent(blockedToken);

  // The rule shows up in settings; removing it unblocks the sender.
  const dialog = await openSettings(page);
  const ruleRow = dialog.locator('li').filter({ hasText: first.fromAddr });
  await expect(ruleRow).toBeVisible();
  await ruleRow.getByRole('button', { name: `Remove block rule ${first.fromAddr}` }).click();
  await expect(ruleRow).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Mail from the sender arrives again (seedMail polls until it does).
  await seedMail({ subjectText: 'Unblocked again', fromAddr: first.fromAddr });
});

test('domain rule from the reading pane blocks subdomains but not lookalike domains', async ({
  page,
}) => {
  const domain = `${freshToken('bd')}.example`;
  const base = await seedMail({
    subjectText: 'Block domain base',
    fromAddr: `alice@${domain}`,
  });
  await page.goto('/');
  await openMailByToken(page, base.token);

  // Block the whole domain from the reading pane's Ban menu.
  const article = page.getByRole('article', { name: 'Message' });
  await article.getByRole('button', { name: 'Block sender' }).click();
  await page.getByRole('menuitem', { name: `Block domain (${domain})` }).click();
  await expect(page.getByText(`Blocked domain ${domain}`)).toBeVisible();

  // A subdomain sender is dropped. The control mail doubles as the lookalike
  // check: `evil<domain>` is NOT a subdomain of <domain> and must arrive.
  const blockedToken = freshToken('bsd');
  await putMailDirect(blockedToken, `bob@news.${domain}`);
  await seedMail({
    subjectText: 'Control lookalike domain',
    fromAddr: `carol@evil${domain}`,
  });
  await expectAbsent(blockedToken);
});

test('settings form adds rules, rejects duplicates, and lists them', async ({ page }) => {
  const domain = `${freshToken('sf')}.example`;
  await page.goto('/');
  const dialog = await openSettings(page);

  // Add a domain rule through the inline form.
  await dialog.getByRole('radio', { name: 'Domain' }).click();
  await dialog.getByRole('textbox', { name: 'Address or domain to block' }).fill(domain);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  const ruleRow = dialog.locator('li').filter({ hasText: domain });
  await expect(ruleRow).toBeVisible();
  await expect(ruleRow.getByText('domain')).toBeVisible();

  // Adding the same rule again surfaces the duplicate error (server 409).
  await dialog.getByRole('textbox', { name: 'Address or domain to block' }).fill(domain);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText('This rule already exists')).toBeVisible();

  // Clean up so later specs seeding *.example senders are unaffected.
  await ruleRow.getByRole('button', { name: `Remove block rule ${domain}` }).click();
  await expect(ruleRow).toHaveCount(0);
});
