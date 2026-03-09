import { Hono } from 'hono';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { appConfig, appContent, announcements, teamAdministration, teamAccounts, competitions, events, eventRegistrationLogs } from '../../db/schema.js';
import { committeeMiddleware } from '../../middlewares/auth.js';
import exportRouter from './export.route.js';
import type { Env, Variables } from '../../types/index.js';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/me
// Returns current committee member's info (role, division, etc.)
// Security: Requires active committee member
// ─────────────────────────────────────────────────────────────────────────────
admin.get('/me', committeeMiddleware(), async (c) => {
  const committee = c.get('committee');

  return c.json({
    success: true,
    committee: {
      id: committee.id,
      name: committee.name,
      role: committee.role, // "Admin" | "Committee" (treated as same)
      division: committee.division,
      isActive: committee.isActive,
    },
  });
});

admin.route('/export', exportRouter);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/config
// Toggle global flags: RELEASE_SCORES or MAINTENANCE_MODE
// Body: { key: "RELEASE_SCORES" | "MAINTENANCE_MODE", value: "true" | "false" }
// ─────────────────────────────────────────────────────────────────────────────
const configSchema = z.object({
  key: z.enum(['RELEASE_SCORES', 'MAINTENANCE_MODE']),
  value: z.enum(['true', 'false']),
});

admin.patch('/config', async (c) => {
  const body = await c.req.json();
  const parsed = configSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
  }

  const { key, value } = parsed.data;
  const db = createDb(c.env);

  await db
    .insert(appConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    });

  return c.json({ success: true, key, value });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/content/:section
// Update static CMS content (FAQs, Judges, Hero, etc.) stored in DB
// Body: { content: string }  — pass JSON.stringify(yourData) as the value
// ─────────────────────────────────────────────────────────────────────────────
const contentSchema = z.object({
  content: z.string().min(1, 'content cannot be empty'),
});

admin.put('/content/:section', async (c) => {
  const section = c.req.param('section');
  const body = await c.req.json();
  const parsed = contentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
  }

  const { content } = parsed.data;
  const db = createDb(c.env);

  await db
    .insert(appContent)
    .values({ section, content, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appContent.section,
      set: { content, updatedAt: new Date() },
    });

  return c.json({ success: true, section, updatedAt: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/announcements
// Create a broadcast announcement
// Body: { title: string, content: string, targetAudience: string, attachmentUrl?: string, scheduledFor?: string }
// ─────────────────────────────────────────────────────────────────────────────
const announcementSchema = z.object({
  title: z.string().min(1, 'title cannot be empty'),
  content: z.string().min(1, 'content cannot be empty'),
  targetAudience: z.enum(['All', 'Paper_Poster', 'BCC', 'GnG', 'HighSchool']),
  attachmentUrl: z.string().url().optional(),
  scheduledFor: z.string().datetime().optional(),
});

const audienceMap: Record<string, string> = {
  'All': 'All',
  'Paper_Poster': 'Paper and Poster Case Competition',
  'BCC': 'Business Case Competition',
  'GnG': 'Geology and Geophysics Case Study Competition (GnG)',
  'HighSchool': 'Highschool Essay Competition',
};

admin.post('/announcements', async (c) => {
  const body = await c.req.json();
  const parsed = announcementSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
  }

  const { title, content, targetAudience, attachmentUrl, scheduledFor } = parsed.data;
  const user = c.get('user');
  const db = createDb(c.env);

  const [created] = await db
    .insert(announcements)
    .values({
      authorId: user.id,
      title,
      content,
      targetAudience: audienceMap[targetAudience] as typeof announcements.$inferInsert['targetAudience'],
      attachmentUrl: attachmentUrl ?? null,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    })
    .returning();

  return c.json({ success: true, announcement: created }, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/verify
// Accept or Reject a team's administration documents
// Body: { teamId: string, action: "Verified" | "Rejected" }
// Security: CommitteeAccount middleware (Admin or Committee role)
// Response: returns updated verification status + full team info
// ─────────────────────────────────────────────────────────────────────────────
const verifySchema = z.object({
  teamId: z.string().uuid('teamId must be a valid UUID'),
  action: z.enum(['Verified', 'Rejected']),
});

admin.post(
  '/verify',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const body = await c.req.json();
    const parsed = verifySchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }

    const { teamId, action } = parsed.data;

    const committee = c.get('committee');
    const db = createDb(c.env);

    const [existing] = await db
      .select({ teamId: teamAdministration.teamId })
      .from(teamAdministration)
      .where(eq(teamAdministration.teamId, teamId))
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Team administration record not found' }, 404);
    }

    const [updated] = await db
      .update(teamAdministration)
      .set({
        verificationStatus: action,
        verifiedBy: committee.id,
      })
      .where(eq(teamAdministration.teamId, teamId))
      .returning();

    const [team] = await db
      .select({
        id: teamAccounts.id,
        teamName: teamAccounts.teamName,
        institution: teamAccounts.institution,
        leadName: teamAccounts.leadName,
        competitionId: teamAccounts.competitionId,
        createdAt: teamAccounts.createdAt,
      })
      .from(teamAccounts)
      .where(eq(teamAccounts.id, teamId))
      .limit(1);

    return c.json({
      success: true,
      verification: {
        teamId: updated.teamId,
        verificationStatus: updated.verificationStatus,
        verifiedBy: updated.verifiedBy,
      },
      team,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/metrics/events
// Per-event registered & attended counts + grand totals
// Security: Admin role OR Event division
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/metrics/events',
  committeeMiddleware({ roles: ['Admin'], divisions: ['Event'] }),
  async (c) => {
    const db = createDb(c.env);

    const rows = await db
      .select({
        id: events.id,
        name: events.name,
        registeredCount: events.registeredCount,
        attendedCount: events.attendedCount,
      })
      .from(events);

    const grandTotalRegistered = rows.reduce((acc, r) => acc + r.registeredCount, 0);
    const grandTotalAttended = rows.reduce((acc, r) => acc + r.attendedCount, 0);

    return c.json({
      events: rows,
      grandTotals: {
        registeredCount: grandTotalRegistered,
        attendedCount: grandTotalAttended,
      },
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/metrics/competitions
// Team count per competition (via COUNT + GROUP BY) + grand total
// Security: Admin or Committee role
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/metrics/competitions',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const db = createDb(c.env);

    const rows = await db
      .select({
        competitionId: competitions.id,
        competitionName: competitions.name,
        teamCount: sql<number>`cast(count(${teamAccounts.id}) as integer)`,
      })
      .from(teamAccounts)
      .rightJoin(competitions, eq(teamAccounts.competitionId, competitions.id))
      .groupBy(competitions.id, competitions.name);

    const grandTotal = rows.reduce((acc, r) => acc + (r.teamCount ?? 0), 0);

    return c.json({
      competitions: rows,
      grandTotal,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/registration-curves
// Competition & Event registration growth curves with daily and cumulative totals
// Security: Admin or Committee role
//
// Description:
//   Retrieves time-series registration data showing both competition team signups
//   and side-event registrations. Returns daily counts and cumulative running totals
//   for each date to visualize marketing growth curves and signup trends.
//
// Response Example:
//   {
//     "registrationCurves": [
//       {
//         "date": "2024-01-15",
//         "competitionSignups": 5,
//         "eventSignups": 12,
//         "totalSignups": 17,
//         "cumulativeCompetitionSignups": 45,
//         "cumulativeEventSignups": 89,
//         "cumulativeTotalSignups": 134
//       }
//     ],
//     "summary": {
//       "totalCompetitionSignups": 150,
//       "totalEventSignups": 280,
//       "totalSignups": 430
//     }
//   }
//
// Query Params: None
// Body: None
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/analytics/registration-curves',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const db = createDb(c.env);

    // Get competition signups grouped by date
    const competitionSignups = await db
      .select({
        date: sql<string>`DATE(${teamAccounts.createdAt})`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(teamAccounts)
      .groupBy(sql`DATE(${teamAccounts.createdAt})`)
      .orderBy(sql`DATE(${teamAccounts.createdAt})`);

    // Get event registration signups grouped by date
    const eventSignups = await db
      .select({
        date: sql<string>`DATE(${eventRegistrationLogs.createdAt})`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(eventRegistrationLogs)
      .groupBy(sql`DATE(${eventRegistrationLogs.createdAt})`)
      .orderBy(sql`DATE(${eventRegistrationLogs.createdAt})`);

    // Merge data by date and calculate cumulative totals
    const dateMap = new Map<string, { competition: number; events: number }>();

    competitionSignups.forEach((row) => {
      if (!dateMap.has(row.date)) {
        dateMap.set(row.date, { competition: 0, events: 0 });
      }
      dateMap.get(row.date)!.competition = row.count;
    });

    eventSignups.forEach((row) => {
      if (!dateMap.has(row.date)) {
        dateMap.set(row.date, { competition: 0, events: 0 });
      }
      dateMap.get(row.date)!.events = row.count;
    });

    // Sort dates and calculate cumulative totals
    const sortedDates = Array.from(dateMap.keys()).sort();
    let cumulativeCompetition = 0;
    let cumulativeEvents = 0;

    const registrationCurves = sortedDates.map((date) => {
      const dailyData = dateMap.get(date)!;
      cumulativeCompetition += dailyData.competition;
      cumulativeEvents += dailyData.events;

      return {
        date,
        competitionSignups: dailyData.competition,
        eventSignups: dailyData.events,
        totalSignups: dailyData.competition + dailyData.events,
        cumulativeCompetitionSignups: cumulativeCompetition,
        cumulativeEventSignups: cumulativeEvents,
        cumulativeTotalSignups: cumulativeCompetition + cumulativeEvents,
      };
    });

    // Calculate summary totals
    const totalCompetitionSignups = competitionSignups.reduce((acc, row) => acc + row.count, 0);
    const totalEventSignups = eventSignups.reduce((acc, row) => acc + row.count, 0);

    return c.json({
      registrationCurves,
      summary: {
        totalCompetitionSignups,
        totalEventSignups,
        totalSignups: totalCompetitionSignups + totalEventSignups,
      },
    });
  },
);

export default admin;
