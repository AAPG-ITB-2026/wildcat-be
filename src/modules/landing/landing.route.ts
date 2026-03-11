import { Hono } from 'hono';
import { registerTeamStep1, registerTeamStep2, checkRegistrationStatus, registerTeamComplete, getTeamData } from './landing.service.js';
import { createDb } from '../../db/index.js';
import type { Env, Variables } from '../../types/index.js';

const landing = new Hono<{ Bindings: Env; Variables: Variables }>();

landing.get('/', async (c) => {
  // 1. Bilingual Handling (NF07)
  // Default to 'id' (Indonesian) if not specified
  const lang = c.req.query('lang') === 'en' ? 'en' : 'id';

  // 2. Static Data Simulation (To be replaced by DB call in BE-10)
  // We mock this now so Frontend can start building.
  const responseData = {
    meta: {
      lang: lang.toUpperCase(),
      generatedAt: new Date().toISOString()
    },
    hero: {
      title: lang === 'en' 
        ? "Leading Petroleum Geoscience to Fuel the Future" 
        : "Memimpin Geosains Minyak Bumi untuk Masa Depan",
      description: lang === 'en'
        ? "Wildcat AAPG ITB 2026 is an annual Petroleum Geoscience-themed competition."
        : "Wildcat AAPG ITB 2026 adalah kompetisi tahunan bertema Geosains Minyak Bumi."
    },
    announcement: null // No announcements yet
  };

  return c.json(responseData);
});

/**
 * Check registration status
 * GET /api/landing/check-registration
 * Auth: Required (user id comes from Supabase token)
 * Response: { registered: boolean, teamId?, competitionId?, isCompleted? }
 * 
 * FE flow after Google login:
 * - If registered=false → redirect to Step 1 registration form
 * - If registered=true && isCompleted=false → redirect to Step 2 form
 * - If registered=true && isCompleted=true → redirect to dashboard
 */
landing.get('/check-registration', async (c) => {
  try {
    const userId = c.get('user')?.id;
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env);
    const result = await checkRegistrationStatus(userId, db);

    return c.json(result, 200);
  } catch (error: any) {
    console.error('[landing] Check registration error:', error);
    return c.json({ error: error.message || 'Check failed' }, 500);
  }
});

/**
 * Get team data
 * GET /api/landing/team
 * Auth: Required (user id comes from Supabase token)
 * Response: Complete team object with all fields, or null if team not found
 * 
 * Used for:
 * - Displaying team dashboard and profile
 * - Pre-filling edit/update forms
 * - Team verification and confirmation
 */
landing.get('/team', async (c) => {
  try {
    const userId = c.get('user')?.id;
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env);
    const team = await getTeamData(userId, db);

    if (!team) {
      return c.json({ error: 'Team not found' }, 404);
    }

    return c.json(team, 200);
  } catch (error: any) {
    console.error('[landing] Get team data error:', error);
    return c.json({ error: error.message || 'Failed to fetch team data' }, 500);
  }
});

/**
 * Step 1: Create team identity (minimal fields)
 * POST /api/landing/register/step1
 * Body: { competitionId, teamName, leadName, institution, leadMajor }
 * Auth: Required (user id comes from Supabase token)
 */
landing.post('/register/step1', async (c) => {
  try {
    const userId = c.get('user')?.id;
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { competitionId, teamName, leadName, institution, leadMajor } = body;

    if (!competitionId || !teamName || !leadName || !institution || !leadMajor) {
      return c.json(
        {
          error: 'Missing required fields: competitionId, teamName, leadName, institution, leadMajor',
        },
        400,
      );
    }

    const db = createDb(c.env);
    const result = await registerTeamStep1(
      {
        id: userId,
        competitionId,
        teamName,
        leadName,
        institution,
        leadMajor,
      },
      db,
    );

    return c.json(result, 201);
  } catch (error: any) {
    console.error('[landing] Step 1 error:', error);
    return c.json({ error: error.message || 'Registration failed' }, 400);
  }
});

/**
 * Step 2: Update team with additional fields (contact + optional members)
 * PATCH /api/landing/register/step2
 * Body: { phoneNumber, lineId, m1Name?, m1Major?, m2Name?, m2Major? }
 * Auth: Required (user id comes from Supabase token, used to find their team)
 */
landing.patch('/register/step2', async (c) => {
  try {
    const userId = c.get('user')?.id;
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { phoneNumber, lineId, m1Name, m1Major, m2Name, m2Major } = body;

    if (!phoneNumber || !lineId) {
      return c.json(
        {
          error: 'Missing required fields: phoneNumber, lineId',
        },
        400,
      );
    }

    const db = createDb(c.env);
    const result = await registerTeamStep2(
      {
        teamId: userId, // user id = team id (1:1 mapping)
        phoneNumber,
        lineId,
        m1Name: m1Name ?? null,
        m1Major: m1Major ?? null,
        m2Name: m2Name ?? null,
        m2Major: m2Major ?? null,
      },
      db,
    );

    return c.json(result, 200);
  } catch (error: any) {
    console.error('[landing] Step 2 error:', error);
    return c.json({ error: error.message || 'Update failed' }, 400);
  }
});

/**
 * Complete Registration: Create or update team with all fields at once (Upsert)
 * POST /api/landing/register/complete
 * Body: { competitionId, teamName, leadName, institution, leadMajor, phoneNumber, lineId, m1Name?, m1Major?, m2Name?, m2Major? }
 * Auth: Required (user id comes from Supabase token)
 * 
 * This endpoint combines Step 1 and Step 2 into a single operation.
 * If the team already exists, it will be updated with the new values.
 * If the team doesn't exist, it will be created.
 * 
 * Response: { teamId: string, created: boolean }
 * - created=true means a new team was created
 * - created=false means an existing team was updated
 */
landing.post('/register/complete', async (c) => {
  try {
    const userId = c.get('user')?.id;
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const {
      competitionId,
      teamName,
      leadName,
      institution,
      leadMajor,
      phoneNumber,
      lineId,
      m1Name,
      m1Major,
      m2Name,
      m2Major,
    } = body;

    // Validate required fields
    if (!competitionId || !teamName || !leadName || !institution || !leadMajor || !phoneNumber || !lineId) {
      return c.json(
        {
          error: 'Missing required fields: competitionId, teamName, leadName, institution, leadMajor, phoneNumber, lineId',
        },
        400,
      );
    }

    const db = createDb(c.env);
    const result = await registerTeamComplete(
      {
        id: userId,
        competitionId,
        teamName,
        leadName,
        institution,
        leadMajor,
        phoneNumber,
        lineId,
        m1Name: m1Name ?? null,
        m1Major: m1Major ?? null,
        m2Name: m2Name ?? null,
        m2Major: m2Major ?? null,
      },
      db,
    );

    const statusCode = result.created ? 201 : 200;
    return c.json(result, statusCode);
  } catch (error: any) {
    console.error('[landing] Complete registration error:', error);
    return c.json({ error: error.message || 'Registration failed' }, 400);
  }
});

export default landing;