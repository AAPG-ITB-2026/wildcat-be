import { Hono } from 'hono';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { appConfig, appContent, announcements, teamAdministration, teamAccounts, competitions, events } from '../../db/schema.js';
import { committeeMiddleware } from '../../middlewares/auth.js';
import type { Env, Variables } from '../../types/index.js';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

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
      targetAudience,
      attachmentUrl: attachmentUrl ?? null,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    })
    .returning();

  return c.json({ success: true, announcement: created }, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/verify
// Accept or Reject a team's administration documents
// Body: { teamId: string, action: "Verified" | "Rejected", rejectionNotes?: string }
// Security: CommitteeAccount middleware (Admin or Committee role)
// Response: returns updated verification status + full team info
// ─────────────────────────────────────────────────────────────────────────────
const verifySchema = z.object({
  teamId: z.string().uuid('teamId must be a valid UUID'),
  action: z.enum(['Verified', 'Rejected']),
  rejectionNotes: z.string().min(1).optional(),
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

    const { teamId, action, rejectionNotes } = parsed.data;

    if (action === 'Rejected' && !rejectionNotes) {
      return c.json({ error: 'rejectionNotes is required when action is "Rejected"' }, 400);
    }

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
        rejectionNotes: action === 'Rejected' ? (rejectionNotes ?? null) : null,
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
        rejectionNotes: updated.rejectionNotes,
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

export default admin;
