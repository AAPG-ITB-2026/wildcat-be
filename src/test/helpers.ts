import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { teamAccounts, committeeAccounts, events, competitions } from '../db/schema.js';
import { Hono } from 'hono';
import teamsRoute from '../modules/teams/teams.route.js';
import membersRoute from '../modules/members/members.route.js';
import eventsRoute from '../modules/events/events.route.js';
import type { Env, Variables } from '../types/index.js';


// NOTE: temporary file to help with unit testing modules

// ── DB ────────────────────────────────────────────────────────────────────────

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
export const testDb = drizzle(client);

// ── App ───────────────────────────────────────────────────────────────────────

export function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/api/teams', teamsRoute);
  app.route('/api/members', membersRoute);
  app.route('/api/events', eventsRoute);
  return app;
}

// ── Factories ─────────────────────────────────────────────────────────────────

let counter = 0;
function uid() {
  return `test-${Date.now()}-${++counter}`;
}

export const TEST_COMPETITION_ID = '00000000-0000-1000-8000-000000000001';

export async function seedCompetition(id = TEST_COMPETITION_ID) {
  const [competition] = await testDb.insert(competitions).values({
    id,
    name: 'Test Competition',
    minMembers: 1,
    maxMembers: 3,
    earlyBirdFee: '0',
    normalBirdFee: '0',
    earlyBirdDeadline: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  }).onConflictDoNothing().returning();
  return competition;
}

export async function cleanupCompetition(id = TEST_COMPETITION_ID) {
  await testDb.delete(competitions).where(eq(competitions.id, id));
}

export function makeTeamPayload(overrides: Record<string, unknown> = {}) {
  const suffix = uid();
  return {
    competitionId: TEST_COMPETITION_ID,
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

// ── Events helpers ────────────────────────────────────────────────────────────

export async function seedCommitteeAccount(id: string) {
  const [account] = await testDb.insert(committeeAccounts).values({
    id,
    name: 'Test Committee',
    role: 'Committee',
    division: 'Test Division',
    isActive: true,
  }).returning();
  return account;
}

export async function cleanupCommitteeAccount(id: string) {
  await testDb.delete(committeeAccounts).where(eq(committeeAccounts.id, id));
}

export async function seedEvent(authorId: string, overrides: Partial<{
  name: string;
  datetime: Date;
  location: string;
  speaker: string | null;
  registrationLink: string;
  isPublished: boolean;
}> = {}) {
  const [event] = await testDb.insert(events).values({
    name: overrides.name ?? 'Test Event',
    datetime: overrides.datetime ?? new Date('2026-06-01T09:00:00Z'),
    location: overrides.location ?? 'Test Venue',
    speaker: overrides.speaker ?? null,
    registrationLink: overrides.registrationLink ?? 'https://register.example.com',
    isPublished: overrides.isPublished ?? true,
    authorId,
  }).returning();
  return event;
}

export async function cleanupEvent(eventId: string) {
  await testDb.delete(events).where(eq(events.id, eventId));
}
