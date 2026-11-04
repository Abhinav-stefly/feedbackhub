import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './testDbUrl.js';

/**
 * Runs ONCE before all tests: brings the test database up to date by applying
 * every committed migration (the same command production deployment uses).
 */
export default function setup() {
  if (process.env.SKIP_DB_MIGRATE === '1') return; // for setups that migrate separately
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
