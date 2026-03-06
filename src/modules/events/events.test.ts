import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, seedCommitteeAccount, cleanupCommitteeAccount, seedEvent, cleanupEvent } from '../../test/helpers.js';
import { randomUUID } from 'crypto';

const app = buildApp();

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

// ── GET /api/events ───────────────────────────────────────────────────────────

describe('GET /api/events', () => {
  const authorId = randomUUID();
  const publishedEventIds: string[] = [];
  const unpublishedEventIds: string[] = [];

  beforeAll(async () => {
    await seedCommitteeAccount(authorId);

    const e1 = await seedEvent(authorId, { name: 'Published Event A', isPublished: true });
    const e2 = await seedEvent(authorId, { name: 'Published Event B', isPublished: true });
    const e3 = await seedEvent(authorId, { name: 'Unpublished Event', isPublished: false });

    publishedEventIds.push(e1.id, e2.id);
    unpublishedEventIds.push(e3.id);
  });

  afterAll(async () => {
    for (const id of [...publishedEventIds, ...unpublishedEventIds]) await cleanupEvent(id);
    await cleanupCommitteeAccount(authorId);
  });

  it('returns 200 with a data array', async () => {
    const res = await req('GET', '/api/events');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('only returns published events (isPublished: true)', async () => {
    const res = await req('GET', '/api/events');
    const body = await res.json() as any;
    const ids = body.data.map((e: any) => e.id);
    for (const id of publishedEventIds) expect(ids).toContain(id);
    for (const id of unpublishedEventIds) expect(ids).not.toContain(id);
  });

  it('each event has expected shape', async () => {
    const res = await req('GET', '/api/events');
    const body = await res.json() as any;
    for (const event of body.data) {
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('name');
      expect(event).toHaveProperty('datetime');
      expect(event).toHaveProperty('location');
      expect(event).toHaveProperty('registrationLink');
      expect(event).toHaveProperty('isPublished');
      expect(event.isPublished).toBe(true);
    }
  });

  it('returns all seeded published events (not truncated to 1)', async () => {
    const res = await req('GET', '/api/events');
    const body = await res.json() as any;
    // Must include both published events we seeded
    expect(body.data.length).toBeGreaterThanOrEqual(2);
  });
});
