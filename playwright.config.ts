import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4100;
const DEMO_PORT = 4200;
// End-to-end tests use the TEST database, never your development data.
const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  'postgresql://feedbackhub:feedbackhub_dev_only@localhost:5432/feedbackhub_test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1, // tests share one database
  reporter: [['list']],
  use: { baseURL: `http://localhost:${DEMO_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Playwright starts BOTH servers for you: the real API (built), and the demo "customer website".
  // They run on different ports, so every widget request is a genuine cross-origin request.
  webServer: [
    {
      command: 'node apps/api/dist/server.js',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: TEST_DB,
        WEB_ORIGIN: 'http://localhost:5173',
        NODE_ENV: 'development',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'node packages/widget/demo/serve.mjs',
      url: `http://localhost:${DEMO_PORT}/health`,
      reuseExistingServer: false,
      env: { PORT: String(DEMO_PORT) },
    },
  ],
});
