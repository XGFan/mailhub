/**
 * AC7 — attachments are forced downloads. The UI links to /api/attachments/:id
 * and that response must carry Content-Disposition: attachment, a neutral
 * application/octet-stream type, and X-Content-Type-Options: nosniff (asserted
 * via a real HTTP request). The raw .eml download is checked the same way.
 */
import { expect, test } from '@playwright/test';
import { seedMail, type SeededMail } from '../helpers/portal';
import { openMailByToken } from '../helpers/ui';

let mail: SeededMail;

test.beforeAll(async () => {
  mail = await seedMail({ fromName: 'Katherine Johnson', subjectText: 'Attachment test' });
});

test('AC7: attachment link points at /api/attachments/:id with forced-download headers', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await openMailByToken(page, mail.token);

  // The attachment chip links to /api/attachments/<uuid>.
  const link = page.locator('a[href^="/api/attachments/"]').first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^\/api\/attachments\/[0-9a-f-]{36}$/);

  // Fetch it directly and assert the hardening headers.
  const res = await request.get(href!);
  expect(res.status()).toBe(200);
  const headers = res.headers();
  expect(headers['content-type']).toBe('application/octet-stream');
  expect(headers['content-disposition']).toContain('attachment');
  expect(headers['content-disposition']).toContain('report.txt');
  expect(headers['x-content-type-options']).toBe('nosniff');
});

test('AC7: raw .eml download is also forced (attachment + nosniff)', async ({ request }) => {
  const res = await request.get(`/api/mails/${mail.item.id}/raw`);
  expect(res.status()).toBe(200);
  const headers = res.headers();
  expect(headers['content-type']).toBe('application/octet-stream');
  expect(headers['content-disposition']).toContain('attachment');
  expect(headers['x-content-type-options']).toBe('nosniff');
});
