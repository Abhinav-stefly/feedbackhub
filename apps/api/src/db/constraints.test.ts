import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * These tests talk to PostgreSQL directly with plain SQL. They prove what the
 * DATABASE itself guarantees, no matter what the application code does.
 */
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Safety: these tests wipe tables. Refuse to run against anything but a test database.
const dbName = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
if (!dbName.endsWith('_test')) {
  throw new Error(`Refusing to run destructive tests on database "${dbName}"`);
}

// Postgres error codes
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const INVALID_ENUM_VALUE = '22P02';

async function insertUser(email: string) {
  const r = await pool.query(
    `INSERT INTO "User" (id, email, "passwordHash", name, "updatedAt")
     VALUES (gen_random_uuid(), $1, 'hash', 'Test', now()) RETURNING id`,
    [email],
  );
  return r.rows[0].id as string;
}

async function insertWorkspace(slug: string) {
  const r = await pool.query(
    `INSERT INTO "Workspace" (id, name, slug, "updatedAt")
     VALUES (gen_random_uuid(), 'WS', $1, now()) RETURNING id`,
    [slug],
  );
  return r.rows[0].id as string;
}

async function insertProject(workspaceId: string, publicKey: string) {
  const r = await pool.query(
    `INSERT INTO "Project" (id, "workspaceId", name, "publicKey", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'P', $2, now()) RETURNING id`,
    [workspaceId, publicKey],
  );
  return r.rows[0].id as string;
}

async function insertFeedback(projectId: string, status = 'UNDER_REVIEW') {
  const r = await pool.query(
    `INSERT INTO "Feedback" (id, "projectId", type, status, title, description, "updatedAt")
     VALUES (gen_random_uuid(), $1, 'FEATURE', $2, 'Dark mode', 'Please', now()) RETURNING id`,
    [projectId, status],
  );
  return r.rows[0].id as string;
}

/** Runs a query that should FAIL and returns the Postgres error code. */
async function failureCode(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

async function newFeedback() {
  const ws = await insertWorkspace(`ws-${crypto.randomUUID()}`);
  const project = await insertProject(ws, `pk_${crypto.randomUUID()}`);
  return insertFeedback(project);
}

beforeEach(async () => {
  await pool.query(
    `TRUNCATE "RoadmapUpdate","Comment","Vote","Feedback","Project","WorkspaceMember","Workspace","User" CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('unique identifiers', () => {
  it('rejects a second user with the same email', async () => {
    await insertUser('a@example.com');
    expect(await failureCode(insertUser('a@example.com'))).toBe(UNIQUE_VIOLATION);
  });

  it('rejects a duplicate project public key', async () => {
    const ws = await insertWorkspace('acme');
    await insertProject(ws, 'pk_same');
    expect(await failureCode(insertProject(ws, 'pk_same'))).toBe(UNIQUE_VIOLATION);
  });

  it('rejects adding the same user to the same workspace twice', async () => {
    const user = await insertUser('a@example.com');
    const ws = await insertWorkspace('acme');
    const add = () =>
      pool.query(
        `INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId") VALUES (gen_random_uuid(), $1, $2)`,
        [ws, user],
      );
    await add();
    expect(await failureCode(add())).toBe(UNIQUE_VIOLATION);
  });
});

describe('voting rules', () => {
  const vote = (feedbackId: string, voterKey: string) =>
    pool.query(
      `INSERT INTO "Vote" (id, "feedbackId", "voterKey") VALUES (gen_random_uuid(), $1, $2)`,
      [feedbackId, voterKey],
    );

  it('blocks the same voter from voting twice on one item', async () => {
    const fb = await newFeedback();
    await vote(fb, 'voter-1');
    expect(await failureCode(vote(fb, 'voter-1'))).toBe(UNIQUE_VIOLATION);
  });

  it('allows different voters, and the same voter on different items', async () => {
    const fb1 = await newFeedback();
    const fb2 = await newFeedback();
    await vote(fb1, 'voter-1');
    await vote(fb1, 'voter-2');
    await vote(fb2, 'voter-1');
    const r = await pool.query(`SELECT count(*)::int AS n FROM "Vote"`);
    expect(r.rows[0].n).toBe(3);
  });

  it('lets exactly ONE of many simultaneous identical votes win', async () => {
    const fb = await newFeedback();
    // 20 requests arrive at the same moment, all from the same voter.
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        pool.query(
          `INSERT INTO "Vote" (id, "feedbackId", "voterKey")
           VALUES (gen_random_uuid(), $1, 'racer') ON CONFLICT ("feedbackId","voterKey") DO NOTHING`,
          [fb],
        ),
      ),
    );
    const inserted = attempts.reduce((sum, r) => sum + (r.rowCount ?? 0), 0);
    expect(inserted).toBe(1);
    const r = await pool.query(`SELECT count(*)::int AS n FROM "Vote" WHERE "feedbackId" = $1`, [
      fb,
    ]);
    expect(r.rows[0].n).toBe(1);
  });
});

describe('relationships', () => {
  it('rejects feedback that points to a project that does not exist', async () => {
    const code = await failureCode(insertFeedback('00000000-0000-0000-0000-000000000000'));
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('deleting feedback also deletes its votes and roadmap updates', async () => {
    const fb = await newFeedback();
    await pool.query(
      `INSERT INTO "Vote" (id, "feedbackId", "voterKey") VALUES (gen_random_uuid(), $1, 'v')`,
      [fb],
    );
    await pool.query(
      `INSERT INTO "RoadmapUpdate" (id, "feedbackId", body) VALUES (gen_random_uuid(), $1, 'Soon')`,
      [fb],
    );
    await pool.query(`DELETE FROM "Feedback" WHERE id = $1`, [fb]);
    const votes = await pool.query(`SELECT count(*)::int AS n FROM "Vote"`);
    const updates = await pool.query(`SELECT count(*)::int AS n FROM "RoadmapUpdate"`);
    expect(votes.rows[0].n).toBe(0);
    expect(updates.rows[0].n).toBe(0);
  });

  it('refuses to delete a user who has written comments', async () => {
    const fb = await newFeedback();
    const author = await insertUser('author@example.com');
    await pool.query(
      `INSERT INTO "Comment" (id, "feedbackId", "authorId", body, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'internal note', now())`,
      [fb, author],
    );
    expect(await failureCode(pool.query(`DELETE FROM "User" WHERE id = $1`, [author]))).toBe(
      FOREIGN_KEY_VIOLATION,
    );
  });
});

describe('allowed values', () => {
  it('rejects a feedback status that is not in the list', async () => {
    const ws = await insertWorkspace('acme');
    const project = await insertProject(ws, 'pk_1');
    expect(await failureCode(insertFeedback(project, 'MAYBE_LATER'))).toBe(INVALID_ENUM_VALUE);
  });

  it('new feedback is private and under review by default', async () => {
    const fb = await newFeedback();
    const r = await pool.query(`SELECT status, "isPublic" FROM "Feedback" WHERE id = $1`, [fb]);
    expect(r.rows[0]).toEqual({ status: 'UNDER_REVIEW', isPublic: false });
  });
});
