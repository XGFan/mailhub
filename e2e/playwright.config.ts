import { defineConfig, devices } from '@playwright/test';
import { PORTAL_BASE_URL, PORTAL_ENV, REPO_ROOT } from './helpers/env';

/**
 * The suite drives ONE shared backend + Postgres, so tests run serially
 * (`workers: 1`, no file-level parallelism) and file names are numbered to make
 * ordering explicit — notably `00-ui-states` asserts the empty-inbox state
 * before anything is seeded. globalSetup brings the stack up; `webServer` starts
 * the portal backend (tsx) which also serves the built SPA on the same origin.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  use: {
    baseURL: PORTAL_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'pnpm --filter @mailhub/portal-server start',
    cwd: REPO_ROOT,
    env: PORTAL_ENV,
    url: `${PORTAL_BASE_URL}/healthz`,
    reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
});
