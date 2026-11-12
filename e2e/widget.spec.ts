import { createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, request as apiRequest, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';

/**
 * End-to-end: a REAL browser, the REAL built API, and a demo "customer website" on a
 * DIFFERENT origin (localhost:4200 vs localhost:4100), so every request is genuinely cross-origin.
 *
 * Rate-limit budget: the API allows 5 submissions per 10 minutes per IP and this file uses
 * 4 real ones. If you add a test that submits, count it!
 */
const API = 'http://localhost:4100';
const DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://feedbackhub:feedbackhub_dev_only@localhost:5432/feedbackhub_test';

const pool = new pg.Pool({ connectionString: DB_URL });
let KEY = '';
const VOTE_TITLE = 'Dark mode please';
const EVIL_TITLE = '<img src=x onerror="window.__pwned=1">';

test.beforeAll(async () => {
  const dbName = new URL(DB_URL).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to wipe database "${dbName}"`);
  await pool.query(
    `TRUNCATE "Session","RoadmapUpdate","Comment","Vote","Feedback","Project","WorkspaceMember","Workspace","User" CASCADE`,
  );

  // Act as the site owner through the real dashboard API.
  const owner = await apiRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Origin: 'http://localhost:5173' },
  });
  const ok = async (res: Awaited<ReturnType<typeof owner.post>>) => {
    expect(res.status(), await res.text()).toBeLessThan(300);
    return res.json();
  };
  await ok(
    await owner.post('/api/auth/register', {
      data: { email: 'owner@shop.example', password: 'a-long-password-123', name: 'Owner' },
    }),
  );
  const { workspace } = await ok(
    await owner.post('/api/workspaces', { data: { name: 'Acme Shop' } }),
  );
  const { project } = await ok(
    await owner.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Webshop' } }),
  );
  await ok(await owner.patch(`/api/projects/${project.id}`, { data: { roadmapPublic: true } }));
  KEY = project.publicKey;
  await owner.dispose();

  // Two ideas that the "team" has published. Inserted directly so the e2e run does not
  // spend the public submission rate limit on set-up.
  for (const title of [VOTE_TITLE, EVIL_TITLE]) {
    await pool.query(
      `INSERT INTO "Feedback" (id, "projectId", type, status, title, description, "isPublic", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'FEATURE', 'PLANNED', $2, 'Many customers asked for this.', true, now())`,
      [project.id, title],
    );
  }
});
test.afterAll(async () => {
  await pool.end();
});

const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors, 'the widget must never throw errors into the host page').toEqual([]);
});

const siteUrl = (extra = '') => `/?key=${KEY}&api=${encodeURIComponent(API)}${extra}`;
const launcher = (page: Page) => page.getByRole('button', { name: 'Feedback', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Share your feedback' });

async function openWidget(page: Page, extra = ''): Promise<Locator> {
  await page.goto(siteUrl(extra));
  await launcher(page).click();
  const panel = dialog(page);
  await expect(panel).toBeVisible();
  return panel;
}

const activeInWidget = (page: Page) =>
  page.evaluate(() => {
    const active = document.getElementById('feedbackhub-widget')?.shadowRoot?.activeElement;
    return active ? active.id || active.className : null;
  });

test('works with one script tag: sends feedback cross-origin, with no cookies and no referrer', async ({
  page,
  context,
}) => {
  // The visitor happens to have a login cookie for localhost. It must NOT be sent to our API.
  await context.addCookies([
    { name: 'fh_session', value: 'host-site-cookie', url: 'http://localhost:4100' },
  ]);

  const apiRequests: Promise<Record<string, string>>[] = [];
  page.on('request', (req) => {
    if (req.url().startsWith(API) && req.method() === 'POST') apiRequests.push(req.allHeaders());
  });

  const panel = await openWidget(page);
  await panel.getByLabel('What kind of feedback is this?').selectOption('BUG');
  await panel.getByLabel('Title', { exact: true }).fill('Checkout button does nothing');
  await panel
    .getByLabel('Details')
    .fill('On the basket page the checkout button does not respond.');
  const response = page.waitForResponse(
    (r) => r.url().includes('/feedback') && r.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Send feedback' }).click();

  await expect(panel.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
  const reply = await response;
  expect(reply.status()).toBe(201);
  expect((await reply.allHeaders())['access-control-allow-origin']).toBe('*');

  const headers = await apiRequests[0];
  expect(headers).toBeDefined();
  expect(headers?.cookie).toBeUndefined();
  expect(headers?.referer).toBeUndefined();

  const { rows } = await pool.query(
    `SELECT title, type, status, "isPublic" FROM "Feedback" WHERE title = 'Checkout button does nothing'`,
  );
  expect(rows).toEqual([
    { title: 'Checkout button does nothing', type: 'BUG', status: 'UNDER_REVIEW', isPublic: false },
  ]);
});

test('leaves the host page alone: nothing added to <head>, one new element in <body>, one global', async ({
  page,
}) => {
  const snapshot = () =>
    page.evaluate(() => ({
      head: document.head.children.length,
      body: [...document.body.children].filter((el) => el.tagName !== 'SCRIPT').length,
      sheets: document.adoptedStyleSheets.length,
      globals: Object.keys(window),
    }));

  await page.goto(siteUrl('&widget=off'));
  const before = await snapshot();

  await page.goto(siteUrl());
  await expect(launcher(page)).toBeVisible();
  const after = await snapshot();

  expect(after.head).toBe(before.head);
  expect(after.sheets).toBe(before.sheets);
  expect(after.body).toBe(before.body + 1);
  expect(after.globals.filter((name) => !before.globals.includes(name))).toEqual(['FeedbackHub']);
  expect(
    await page.evaluate(() =>
      Object.keys((window as unknown as { FeedbackHub: object }).FeedbackHub).sort(),
    ),
  ).toEqual(['close', 'destroy', 'open', 'version']);
});

test('is not broken by hostile host-page CSS', async ({ page }) => {
  await page.goto(siteUrl('&hostile=1'));
  // Prove the hostile CSS really is hurting the host page ...
  expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).fontSize)).toBe('48px');
  await expect(page.getByRole('button', { name: 'Add to basket' })).toBeHidden();

  // ... yet the widget still looks and works as designed.
  const button = launcher(page);
  await expect(button).toBeVisible();
  const style = await button.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      fontSize: s.fontSize,
      color: s.color,
      letterSpacing: s.letterSpacing,
      textTransform: s.textTransform,
    };
  });
  expect(style).toEqual({
    fontSize: '14px',
    color: 'rgb(255, 255, 255)',
    letterSpacing: 'normal',
    textTransform: 'none',
  });

  await button.click();
  const panel = dialog(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Title', { exact: true })).toBeVisible();
  expect(
    await panel
      .getByLabel('Title', { exact: true })
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe('14px');

  // Plain text (unlike buttons) INHERITS from the host element, so it is the real test of the
  // ":host { all: initial }" reset: the page tried to make everything 8px-spaced and UPPERCASE.
  const heading = await panel
    .getByRole('heading', { name: 'Share your feedback' })
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { letterSpacing: s.letterSpacing, textTransform: s.textTransform, color: s.color };
    });
  expect(heading).toEqual({
    letterSpacing: 'normal',
    textTransform: 'none',
    color: 'rgb(17, 24, 39)',
  });
});

test('can be used with the keyboard alone', async ({ page }) => {
  await page.goto(siteUrl());
  await launcher(page).focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeVisible();
  expect(await activeInWidget(page)).toBe('fh-title');

  // Tab many times: focus must never escape the open dialog.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const root = document.getElementById('feedbackhub-widget')?.shadowRoot;
      return (
        !!root?.activeElement && !!root.getElementById('fh-panel')?.contains(root.activeElement)
      );
    });
    expect(inside, `focus escaped the dialog after ${i + 1} Tab presses`).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  expect(await activeInWidget(page)).toBe('fh-launcher');
});

test('lets visitors vote, remembers them across visits, and stores only a fingerprint', async ({
  page,
}) => {
  const panel = await openWidget(page);
  await panel.getByRole('tab', { name: 'Vote on ideas' }).click();
  const vote = panel.getByRole('button', { name: /Vote for: Dark mode please/ });
  await expect(vote).toHaveAttribute('aria-pressed', 'false');
  await vote.click();
  await expect(vote).toHaveAttribute('aria-pressed', 'true');
  await expect(vote).toContainText('1');

  const voterId = await page.evaluate(() => localStorage.getItem('feedbackhub:voter-id'));
  expect(voterId).toMatch(/^[A-Za-z0-9_-]{24}$/);
  const { rows } = await pool.query(`SELECT "voterKey" FROM "Vote"`);
  expect(rows).toEqual([
    {
      voterKey: createHash('sha256')
        .update(voterId as string)
        .digest('hex'),
    },
  ]);

  // A new visit: the browser remembers the voter id, so the vote is still shown.
  await page.reload();
  await launcher(page).click();
  await dialog(page).getByRole('tab', { name: 'Vote on ideas' }).click();
  const again = dialog(page).getByRole('button', { name: /Vote for: Dark mode please/ });
  await expect(again).toHaveAttribute('aria-pressed', 'true');

  await again.click();
  await expect(again).toHaveAttribute('aria-pressed', 'false');
  expect((await pool.query(`SELECT count(*)::int AS n FROM "Vote"`)).rows[0].n).toBe(0);
});

test('shows hostile idea titles as plain text and runs none of it', async ({ page }) => {
  const panel = await openWidget(page);
  await panel.getByRole('tab', { name: 'Vote on ideas' }).click();
  await expect(panel.getByText(EVIL_TITLE, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
  expect(
    await page.evaluate(
      () =>
        document.getElementById('feedbackhub-widget')?.shadowRoot?.querySelectorAll('img').length,
    ),
  ).toBe(0);
});

test('keeps what the visitor typed when the network fails, and recovers on retry', async ({
  page,
}) => {
  const panel = await openWidget(page);
  await page.route(`${API}/api/public/**`, (route) => route.abort('failed'));

  await panel.getByLabel('Title', { exact: true }).fill('Please add a wishlist');
  await panel.getByLabel('Details').fill('A wishlist would help me plan my purchases.');
  await panel.getByRole('button', { name: 'Send feedback' }).click();
  await expect(panel.getByText(/couldn't reach the server/i)).toBeVisible();
  await expect(panel.getByLabel('Title', { exact: true })).toHaveValue('Please add a wishlist');

  await page.unroute(`${API}/api/public/**`);
  await panel.getByRole('button', { name: 'Send feedback' }).click();
  await expect(panel.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
});

test('tells the visitor when the server is slow to wake up, then still succeeds', async ({
  page,
}) => {
  test.setTimeout(40_000);
  const panel = await openWidget(page);
  await page.route(`${API}/api/public/**`, async (route) => {
    if (route.request().method() === 'POST')
      await new Promise((resolve) => setTimeout(resolve, 7_000));
    await route.continue();
  });

  await panel.getByLabel('Title', { exact: true }).fill('Slow server test');
  await panel.getByLabel('Details').fill('Testing the slow-server message properly.');
  await panel
    .getByRole('button', { name: 'Sending…' })
    .or(panel.getByRole('button', { name: 'Send feedback' }))
    .click();
  await expect(panel.getByText(/server may be waking up/i)).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole('heading', { name: 'Thank you!' })).toBeVisible({ timeout: 15_000 });
});

test('still works on a page with a strict Content-Security-Policy', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/content security policy/i.test(msg.text())) violations.push(msg.text());
  });
  const panel = await openWidget(page, '&csp=strict');
  await panel.getByLabel('Title', { exact: true }).fill('CSP page feedback');
  await panel.getByLabel('Details').fill('Sent from a page with a strict policy.');
  await panel.getByRole('button', { name: 'Send feedback' }).click();
  await expect(panel.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const panel = await openWidget(page);
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(667);
  await panel.getByRole('button', { name: 'Send feedback' }).scrollIntoViewIfNeeded();
  await expect(panel.getByRole('button', { name: 'Send feedback' })).toBeInViewport();
});

test("follows the visitor's dark mode setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const panel = await openWidget(page);
  expect(await panel.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(17, 24, 39)',
  );
});

test('can be customised from the script tag', async ({ page }) => {
  await page.goto(siteUrl('&color=%23facc15&position=bottom-left&label=Help%20us'));
  const button = page.getByRole('button', { name: 'Help us', exact: true });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box?.x).toBeLessThan(100); // on the left
  expect(await button.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(17, 24, 39)'); // dark text on yellow
});

test("a wrong install never breaks the customer's website", async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') logs.push(msg.text());
  });
  await page.goto('/?key=pk_not_a_real_key');
  await expect(page.getByRole('button', { name: 'Add to basket' })).toBeVisible();
  await expect(page.locator('#feedbackhub-widget')).toHaveCount(0);
  expect(
    logs.some((line) => line.includes('[FeedbackHub]') && line.includes('data-project-key')),
  ).toBe(true);
});

test('has no automatically detectable accessibility problems (send and vote views)', async ({
  page,
}) => {
  const panel = await openWidget(page);
  const scan = () => new AxeBuilder({ page }).include('#feedbackhub-widget').analyze();

  const sendView = await scan();
  expect(
    sendView.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`),
  ).toEqual([]);

  await panel.getByRole('tab', { name: 'Vote on ideas' }).click();
  await expect(panel.getByRole('button', { name: /Vote for/ }).first()).toBeVisible();
  const ideasView = await scan();
  expect(
    ideasView.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`),
  ).toEqual([]);
});
