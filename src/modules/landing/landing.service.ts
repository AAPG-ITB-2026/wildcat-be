import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { competitions, teamAccounts } from '../../db/schema.js';

export interface Step1RegistrationInput {
  id: string; // Supabase auth user id
  competitionId: string;
  teamName: string;
  leadName: string;
  institution: string;
  leadMajor: string;
}

export interface Step2RegistrationInput {
  teamId: string; // team_accounts.id
  phoneNumber: string;
  lineId: string;
  m1Name?: string | null;
  m1Major?: string | null;
  m2Name?: string | null;
  m2Major?: string | null;
}

/**
 * Step 1: Create team identity with minimal required fields.
 * Validates competition exists, then creates teamAccounts row.
 */
export async function registerTeamStep1(
  input: Step1RegistrationInput,
  db: PostgresJsDatabase,
): Promise<{ teamId: string }> {
  // Validate competition exists
  const [competition] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, input.competitionId))
    .limit(1);

  if (!competition) {
    throw new Error(`Competition "${input.competitionId}" not found`);
  }

  // Create team account with minimal fields
  // Phone and lineId are required in schema, so we set empty strings for now
  await db.insert(teamAccounts).values({
    id: input.id,
    competitionId: input.competitionId,
    teamName: input.teamName,
    leadName: input.leadName,
    institution: input.institution,
    leadMajor: input.leadMajor,
    phoneNumber: '', // Filled in Step 2
    lineId: '', // Filled in Step 2
    m1Name: null,
    m1Major: null,
    m2Name: null,
    m2Major: null,
  });

  return { teamId: input.id };
}

/**
 * Step 2: Update team with additional fields (contact + optional members).
 */
export async function registerTeamStep2(
  input: Step2RegistrationInput,
  db: PostgresJsDatabase,
): Promise<{ success: true }> {
  // Validate team exists
  const [team] = await db
    .select()
    .from(teamAccounts)
    .where(eq(teamAccounts.id, input.teamId))
    .limit(1);

  if (!team) {
    throw new Error(`Team "${input.teamId}" not found`);
  }

  // Update with additional fields
  await db
    .update(teamAccounts)
    .set({
      phoneNumber: input.phoneNumber,
      lineId: input.lineId,
      m1Name: input.m1Name ?? null,
      m1Major: input.m1Major ?? null,
      m2Name: input.m2Name ?? null,
      m2Major: input.m2Major ?? null,
    })
    .where(eq(teamAccounts.id, input.teamId));

  return { success: true };
}
