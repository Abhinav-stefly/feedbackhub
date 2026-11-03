import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Tests must never depend on a developer's local .env file.
    env: { NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'silent', WEB_ORIGIN: 'http://localhost:5173' },
  },
});