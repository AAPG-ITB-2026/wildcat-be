import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { competitions, teamAccounts, teamAdministration, transactions } from '../../db/schema.js';

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

export interface CompleteRegistrationInput extends Step1RegistrationInput, Omit<Step2RegistrationInput, 'teamId'> {
  // Combines both Step 1 and Step 2 fields
  // id, competitionId, teamName, leadName, institution, leadMajor (from Step 1)
  // phoneNumber, lineId, m1Name?, m1Major?, m2Name?, m2Major? (from Step 2)
}

/**
 * Step 1: Create team identity with minimal required fields.
 * Validates competition exists, then creates teamAccounts row.
 */
export async function registerTeamStep1(
  input: Step1RegistrationInput,
  db: any,
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
 * Validates that the team member count falls within the competition's min/max requirements.
 */
export async function registerTeamStep2(
  input: Step2RegistrationInput,
  db: any,
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

  // Fetch competition details to check member count constraints
  const [competition] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, team.competitionId))
    .limit(1);

  if (!competition) {
    throw new Error(`Competition "${team.competitionId}" not found`);
  }

  // Calculate total member count: lead + optional members
  const memberCount =
    1 + // lead is always present
    (input.m1Name ? 1 : 0) +
    (input.m2Name ? 1 : 0);

  // Validate member count against competition constraints
  if (memberCount < competition.minMembers) {
    throw new Error(
      `Team must have at least ${competition.minMembers} members. Current: ${memberCount}`,
    );
  }

  if (memberCount > competition.maxMembers) {
    throw new Error(
      `Team cannot exceed ${competition.maxMembers} members. Current: ${memberCount}`,
    );
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

/**
 * Check if user has already registered for a team.
 * Used by FE after Google login to determine redirect flow.
 * 
 * Returns registration status with document verification and payment status.
 */
export async function checkRegistrationStatus(
  userId: string,
  db: any,
): Promise<{
  registered: boolean;
  teamId?: string;
  competitionId?: string;
  isCompleted?: boolean; // true if both Step 1 & 2 done (phoneNumber/lineId are non-empty)
  documentVerificationStatus?: string | null; // 'Verified', 'Rejected', 'Pending', or null
  paymentVerificationStatus?: string | null; // 'Verified', 'Rejected', 'Pending', or null
  documentRejectionNotes?: string | null; // Notes provided when a document is rejected
  paymentRejectionNotes?: string | null; // Notes provided when a payment is rejected
}> {
  // Fetch team account with document verification status
  const [team] = await db
    .select({
      teamAccounts: teamAccounts,
      teamAdministration: teamAdministration,
    })
    .from(teamAccounts)
    .leftJoin(teamAdministration, eq(teamAccounts.id, teamAdministration.teamId))
    .where(eq(teamAccounts.id, userId))
    .limit(1);

  if (!team || !team.teamAccounts) {
    return { registered: false };
  }

  // Fetch most recent transaction (sorted by createdAt DESC)
  const [latestTransaction] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.teamId, team.teamAccounts.id))
    .orderBy((t: any) => t.createdAt) // DESC by default in Drizzle
    .limit(1);

  // Check if Step 2 is completed (contact fields filled)
  const isCompleted = !!(team.teamAccounts.phoneNumber && team.teamAccounts.lineId);

  return {
    registered: true,
    teamId: team.teamAccounts.id,
    competitionId: team.teamAccounts.competitionId,
    isCompleted,
    documentVerificationStatus: team.teamAdministration?.verificationStatus ?? null,
    paymentVerificationStatus: latestTransaction?.verificationStatus ?? null,
    documentRejectionNotes: team.teamAdministration?.rejectionNotes ?? null,
    paymentRejectionNotes: latestTransaction?.rejectionNotes ?? null,
  };
}

/**
 * Complete Registration (Upsert): Create or update team with all fields at once.
 * Combines Step 1 and Step 2 into a single operation.
 * Validates that the team member count falls within the competition's min/max requirements.
 * 
 * If team already exists, it will be updated with new values.
 * If team doesn't exist, it will be created.
 * 
 * This is useful for:
 * - Direct registration with all data (bypass step-by-step flow)
 * - Updating existing registration with complete data
 */
export async function registerTeamComplete(
  input: CompleteRegistrationInput,
  db: any,
): Promise<{ teamId: string; created: boolean }> {
  // Validate competition exists
  const [competition] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, input.competitionId))
    .limit(1);

  if (!competition) {
    throw new Error(`Competition "${input.competitionId}" not found`);
  }

  // Calculate total member count: lead + optional members
  const memberCount =
    1 + // lead is always present
    (input.m1Name ? 1 : 0) +
    (input.m2Name ? 1 : 0);

  // Validate member count against competition constraints
  if (memberCount < competition.minMembers) {
    throw new Error(
      `Team must have at least ${competition.minMembers} members. Current: ${memberCount}`,
    );
  }

  if (memberCount > competition.maxMembers) {
    throw new Error(
      `Team cannot exceed ${competition.maxMembers} members. Current: ${memberCount}`,
    );
  }

  // Check if team already exists
  const [existingTeam] = await db
    .select()
    .from(teamAccounts)
    .where(eq(teamAccounts.id, input.id))
    .limit(1);

  if (existingTeam) {
    // Update existing team
    await db
      .update(teamAccounts)
      .set({
        competitionId: input.competitionId,
        teamName: input.teamName,
        leadName: input.leadName,
        institution: input.institution,
        leadMajor: input.leadMajor,
        phoneNumber: input.phoneNumber,
        lineId: input.lineId,
        m1Name: input.m1Name ?? null,
        m1Major: input.m1Major ?? null,
        m2Name: input.m2Name ?? null,
        m2Major: input.m2Major ?? null,
      })
      .where(eq(teamAccounts.id, input.id));

    return { teamId: input.id, created: false };
  }

  // Create new team with all fields
  await db.insert(teamAccounts).values({
    id: input.id,
    competitionId: input.competitionId,
    teamName: input.teamName,
    leadName: input.leadName,
    institution: input.institution,
    leadMajor: input.leadMajor,
    phoneNumber: input.phoneNumber,
    lineId: input.lineId,
    m1Name: input.m1Name ?? null,
    m1Major: input.m1Major ?? null,
    m2Name: input.m2Name ?? null,
    m2Major: input.m2Major ?? null,
  });

  return { teamId: input.id, created: true };
}

/**
 * Get team data: Fetch complete team information for authenticated user.
 * Used for displaying team dashboard, edit forms, and verification.
 * 
 * Returns the full team object with all fields.
 * Returns null if team not found.
 */
export async function getTeamData(
  userId: string,
  db: any,
): Promise<{
  id: string;
  competitionId: string;
  teamName: string;
  leadName: string;
  institution: string;
  leadMajor: string;
  phoneNumber: string;
  lineId: string;
  m1Name: string | null;
  m1Major: string | null;
  m2Name: string | null;
  m2Major: string | null;
} | null> {
  const [team] = await db
    .select()
    .from(teamAccounts)
    .where(eq(teamAccounts.id, userId))
    .limit(1);

  if (!team) {
    return null;
  }

  return {
    id: team.id,
    competitionId: team.competitionId,
    teamName: team.teamName,
    leadName: team.leadName,
    institution: team.institution,
    leadMajor: team.leadMajor,
    phoneNumber: team.phoneNumber,
    lineId: team.lineId,
    m1Name: team.m1Name,
    m1Major: team.m1Major,
    m2Name: team.m2Name,
    m2Major: team.m2Major,
  };
}
