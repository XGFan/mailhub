/**
 * Mobile layout: nothing may be wider than the viewport.
 *
 * Regression guard — a mail whose subject / sender is one long unbroken token
 * used to widen the whole document, because none of the layout panes had a
 * `min-width: 0` floor (a flex item's automatic minimum size is its *content*).
 * The overflow was not confined to the mail body: the document itself grew, so
 * the header and the list toolbar (both 100%-wide) got pushed off-screen too.
 */
import { expect, test, type Page } from '@playwright/test';
import { seedMail } from '../helpers/portal';
import { openMailByToken, rows } from '../helpers/ui';

const PHONE = { width: 390, height: 844 };

/** No spaces anywhere — the worst case for intrinsic min-content sizing. */
const LONG_SUBJECT =
  'Reset-your-password-now-https://accounts.example.com/verify/aVeryLongOpaqueToken0123456789abcdef';

let token: string;

test.beforeAll(async () => {
  ({ token } = await seedMail({
    subjectText: LONG_SUBJECT,
    fromName: 'Averyveryverylongsendernamewithnospacesatallanywhere',
    fromAddr: 'no-reply-with-a-really-long-local-part@a-very-long-sender-domain.example.com',
  }));
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
});

interface Overflow {
  /** How far the document scrolls past the viewport (0 ⇒ no sideways scroll). */
  documentPx: number;
  /** Worst single offender, for a readable failure message. */
  worst: { px: number; description: string };
}

/**
 * Measure horizontal overflow. `scrollWidth` on the root is the user-visible
 * symptom (the page scrolls sideways); the per-element sweep just names the
 * culprit when it fails. Content inside the sandboxed iframe is a separate
 * document and is intentionally out of scope here.
 */
async function measureOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const vw = root.clientWidth;
    const worst = { px: 0, description: 'none' };
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const px = Math.round(rect.right - vw);
      if (px > worst.px) {
        const cls = typeof el.className === 'string' ? el.className.slice(0, 90) : '';
        worst.px = px;
        worst.description = `<${el.tagName.toLowerCase()} class="${cls}">`;
      }
    }
    return { documentPx: root.scrollWidth - vw, worst };
  });
}

async function expectNoOverflow(page: Page, where: string): Promise<void> {
  const { documentPx, worst } = await measureOverflow(page);
  expect(
    documentPx,
    `${where}: document scrolls ${documentPx}px past the viewport (worst element +${worst.px}px: ${worst.description})`,
  ).toBeLessThanOrEqual(0);
  expect(worst.px, `${where}: ${worst.description} overflows by ${worst.px}px`).toBeLessThanOrEqual(0);
}

test('mail list fits the phone viewport (long subject and sender)', async ({ page }) => {
  await page.goto('/');
  await expect(rows(page).first()).toBeVisible();

  await expectNoOverflow(page, 'list view');
});

test('reading pane fits the phone viewport (long subject and sender)', async ({ page }) => {
  await page.goto('/');
  await openMailByToken(page, token);
  // The long subject is what used to widen the document.
  await expect(page.getByRole('heading', { level: 1 })).toContainText(LONG_SUBJECT);

  await expectNoOverflow(page, 'reading pane');
});
