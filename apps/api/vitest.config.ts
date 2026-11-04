import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './src/test/testDbUrl.js';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./src/test/globalSetup.ts'],
    // Tests must never depend on a developer's local .env file.
    env: {
      NODE_ENV: 'test',
      PORT: '0',
      LOG_LEVEL: 'silent',
      WEB_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: TEST_DATABASE_URL,
    },
  },
});
