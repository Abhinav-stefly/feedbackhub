/** Tests ALWAYS use a separate database, never your development data. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://feedbackhub:feedbackhub_dev_only@localhost:5432/feedbackhub_test';
