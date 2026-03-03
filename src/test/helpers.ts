import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { teamAccounts } from '../db/schema.js';
import { Hono } from 'hono';
import teamsRoute from '../modules/teams/teams.route.js';
import membersRoute from '../modules/members/members.route.js';
import type { Env, Variables } from '../types/index.js';

// ── DB ────────────────────────────────────────────────────────────────────────

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
export const testDb = drizzle(client);

// ── App ───────────────────────────────────────────────────────────────────────

export function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/api/teams', teamsRoute);
  app.route('/api/members', membersRoute);
  return app;
}

// ── Factories ─────────────────────────────────────────────────────────────────

let counter = 0;
function uid() {
  return `test-${Date.now()}-${++counter}`;
}

export function makeTeamPayload(overrides: Record<string, unknown> = {}) {
  const suffix = uid();
  return {
    competitionId: '00000000-0000-0000-0000-000000000001', // must exist in competitions table
    teamName: `Test Team ${suffix}`,
    institution: 'Test University',
    phoneNumber: '08123456789',
    lineId: `line_${suffix}`,
    leadName: 'Lead Person',
    leadMajor: 'Computer Science',
    ...overrides,
  };
}

/**
 * Inserts a team directly via the DB (bypasses auth).
 * Returns the inserted teamAccounts row.
 */
export async function seedTeam(userId: string, overrides: Record<string, unknown> = {}) {
  const payload = makeTeamPayload(overrides);
  const [team] = await testDb.insert(teamAccounts).values({
    id: userId,
    competitionId: payload.competitionId as string,
    teamName: payload.teamName as string,
    institution: payload.institution as string,
    phoneNumber: payload.phoneNumber as string,
    lineId: payload.lineId as string,
    leadName: payload.leadName as string,
    leadMajor: payload.leadMajor as string,
  }).returning();
  return team;
}

export async function cleanupTeam(teamId: string) {
  await testDb.delete(teamAccounts).where(eq(teamAccounts.id, teamId));
}
