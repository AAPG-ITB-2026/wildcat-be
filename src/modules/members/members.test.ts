import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { buildApp, seedTeam, cleanupTeam, seedCompetition, cleanupCompetition } from '../../test/helpers.js';
import { randomUUID } from 'crypto';

const app = buildApp();

beforeAll(async () => { await seedCompetition(); });
afterAll(async () => { await cleanupCompetition(); });

const mockEnv = {
  DATABASE_URL: process.env.DATABASE_URL!,
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
};

async function req(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }, mockEnv as any);
}

// ── POST /api/members/:teamId ─────────────────────────────────────────────────

describe('POST /api/members/:teamId', () => {
  let teamId: string;
  beforeEach(async () => {
    teamId = randomUUID();
    await seedTeam(teamId);
  });
  afterEach(async () => { await cleanupTeam(teamId); });

  it('adds first member → fills m1 slot', async () => {
    const res = await req('POST', `/api/members/${teamId}`, { fullName: 'Alice Smith', major: 'CS' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.slot).toBe('m1');
    expect(body.data.fullName).toBe('Alice Smith');
  });

  it('adds second member → fills m2 slot', async () => {
    await req('POST', `/api/members/${teamId}`, { fullName: 'Alice', major: 'CS' });
    const res = await req('POST', `/api/members/${teamId}`, { fullName: 'Bob', major: 'Math' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.slot).toBe('m2');
  });

  it('third add when both slots filled → 409 MEMBER_LIMIT_REACHED', async () => {
    await req('POST', `/api/members/${teamId}`, { fullName: 'Alice', major: 'CS' });
    await req('POST', `/api/members/${teamId}`, { fullName: 'Bob', major: 'Math' });
    const res = await req('POST', `/api/members/${teamId}`, { fullName: 'Charlie', major: 'Physics' });
    expect(res.status).toBe(409);
  });

  it('teamId does not exist → 404', async () => {
    const res = await req('POST', `/api/members/${randomUUID()}`, { fullName: 'Alice', major: 'CS' });
    expect(res.status).toBe(404);
  });

  it('missing fullName → 400', async () => {
    const res = await req('POST', `/api/members/${teamId}`, { major: 'CS' });
    expect(res.status).toBe(400);
  });

  it('fullName too short (< 2 chars) → 400', async () => {
    const res = await req('POST', `/api/members/${teamId}`, { fullName: 'A', major: 'CS' });
    expect(res.status).toBe(400);
  });

  it('after deleting m1, next add refills m1 (not m2)', async () => {
    await req('POST', `/api/members/${teamId}`, { fullName: 'Alice', major: 'CS' });
    await req('POST', `/api/members/${teamId}`, { fullName: 'Bob', major: 'Math' });
    await req('DELETE', `/api/members/${teamId}/m1`);
    const res = await req('POST', `/api/members/${teamId}`, { fullName: 'Carol', major: 'Bio' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.slot).toBe('m1');
  });
});

// ── GET /api/members/:teamId ──────────────────────────────────────────────────

describe('GET /api/members/:teamId', () => {
  let teamId: string;
  beforeAll(async () => {
    teamId = randomUUID();
    await seedTeam(teamId);
  });
  afterAll(async () => { await cleanupTeam(teamId); });

  it('team with only lead → returns array of 1', async () => {
    const res = await req('GET', `/api/members/${teamId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].slot).toBe('lead');
  });

  it('team with lead + m1 → returns array of 2', async () => {
    await req('POST', `/api/members/${teamId}`, { fullName: 'Alice', major: 'CS' });
    const res = await req('GET', `/api/members/${teamId}`);
    const body = await res.json() as any;
    expect(body.data).toHaveLength(2);
  });

  it('team with lead + m1 + m2 → returns array of 3', async () => {
    await req('POST', `/api/members/${teamId}`, { fullName: 'Bob', major: 'Math' });
    const res = await req('GET', `/api/members/${teamId}`);
    const body = await res.json() as any;
    expect(body.data).toHaveLength(3);
  });

  it('each entry has { slot, fullName, major } shape', async () => {
    const res = await req('GET', `/api/members/${teamId}`);
    const body = await res.json() as any;
    for (const member of body.data) {
      expect(member).toHaveProperty('slot');
      expect(member).toHaveProperty('fullName');
      expect(member).toHaveProperty('major');
    }
  });

  it('non-existent teamId → 404', async () => {
    const res = await req('GET', `/api/members/${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/members/:teamId/:slot ─────────────────────────────────────────

describe('PATCH /api/members/:teamId/:slot', () => {
  let teamId: string;
  beforeEach(async () => {
    teamId = randomUUID();
    await seedTeam(teamId);
    await req('POST', `/api/members/${teamId}`, { fullName: 'Alice', major: 'CS' });
    await req('POST', `/api/members/${teamId}`, { fullName: 'Bob', major: 'Math' });
  });
  afterEach(async () => { await cleanupTeam(teamId); });

  it('updates m1 fullName only → m1Major unchanged', async () => {
    const res = await req('PATCH', `/api/members/${teamId}/m1`, { fullName: 'Alice Updated' });
    expect(res.status).toBe(202);
    const body = await res.json() as any;
    expect(body.data.fullName).toBe('Alice Updated');
    expect(body.data.major).toBe('CS');
  });

  it('updates both fields on m2', async () => {
    const res = await req('PATCH', `/api/members/${teamId}/m2`, { fullName: 'Bob Updated', major: 'Physics' });
    expect(res.status).toBe(202);
    const body = await res.json() as any;
    expect(body.data.fullName).toBe('Bob Updated');
    expect(body.data.major).toBe('Physics');
  });

  it('invalid slot (not m1 or m2) → 400', async () => {
    const res = await req('PATCH', `/api/members/${teamId}/lead`, { fullName: 'X' });
    expect(res.status).toBe(400);
  });

  it('empty body {} → 202, values unchanged (all fields optional)', async () => {
    const res = await req('PATCH', `/api/members/${teamId}/m1`, {});
    expect(res.status).toBe(202);
    const body = await res.json() as any;
    expect(body.data.slot).toBe('m1');
  });
});

// ── DELETE /api/members/:teamId/:slot ─────────────────────────────────────────

describe('DELETE /api/members/:teamId/:slot', () => {
  let teamId: string;
  beforeEach(async () => {
    teamId = randomUUID();
    await seedTeam(teamId);
    await req('POST', `/api/members/${teamId}`, { fullName: 'Alice', major: 'CS' });
    await req('POST', `/api/members/${teamId}`, { fullName: 'Bob', major: 'Math' });
  });
  afterEach(async () => { await cleanupTeam(teamId); });

  it('deletes m1 → { slot: m1, deleted: true }, subsequent GET shows no m1', async () => {
    const res = await req('DELETE', `/api/members/${teamId}/m1`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.slot).toBe('m1');
    expect(body.data.deleted).toBe(true);

    const getRes = await req('GET', `/api/members/${teamId}`);
    const getBody = await getRes.json() as any;
    expect(getBody.data.some((m: any) => m.slot === 'm1')).toBe(false);
    expect(getBody.data.some((m: any) => m.slot === 'm2')).toBe(true);
  });

  it('deletes m2 independently of m1', async () => {
    const res = await req('DELETE', `/api/members/${teamId}/m2`);
    expect(res.status).toBe(200);
    const getRes = await req('GET', `/api/members/${teamId}`);
    const getBody = await getRes.json() as any;
    expect(getBody.data.some((m: any) => m.slot === 'm1')).toBe(true);
    expect(getBody.data.some((m: any) => m.slot === 'm2')).toBe(false);
  });

  it('slot "lead" → 400 (not in memberSlotSchema)', async () => {
    const res = await req('DELETE', `/api/members/${teamId}/lead`);
    expect(res.status).toBe(400);
  });

  it('non-existent teamId → 404 (gap now fixed)', async () => {
    const res = await req('DELETE', `/api/members/${randomUUID()}/m1`);
    expect(res.status).toBe(404);
  });
});
