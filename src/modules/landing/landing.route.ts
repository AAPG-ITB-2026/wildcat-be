import { Hono } from 'hono';
import { registerTeamStep1, registerTeamStep2 } from './landing.service.js';
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

export default landing;