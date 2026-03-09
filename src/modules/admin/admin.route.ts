import { Hono } from 'hono';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { appConfig, appContent, announcements, teamAdministration, teamAccounts, competitions, competitionStages, stageRequirements, events } from '../../db/schema.js';
import { committeeMiddleware } from '../../middlewares/auth.js';
import exportRouter from './export.route.js';
import type { Env, Variables } from '../../types/index.js';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();


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

const updateStageSchema = z.object({
  name: z.string().min(1, 'name cannot be empty').optional(),
  startDate: z.string().datetime('startDate must be a valid ISO 8601 datetime').optional(),
  endDate: z.string().datetime('endDate must be a valid ISO 8601 datetime').optional(),
});

const requirementItemSchema = z.object({
  documentName: z.string().min(1, 'documentName cannot be empty'),
  allowedExtensions: z
    .string()
    .min(1, 'allowedExtensions cannot be empty')
    .refine(
      (val) => val.split(',').every((part) => /^[\w\-]+\/[\w\-+.]+$/.test(part.trim())),
      { message: 'allowedExtensions must be a comma-separated list of valid MIME types (e.g., "application/pdf,image/png")' },
    ),
  maxSizeMb: z.number().int().positive('maxSizeMb must be a positive integer'),
  isMandatory: z.boolean().default(true),
});

const setRequirementsSchema = z.object({
  requirements: z.array(requirementItemSchema).min(1, 'requirements array cannot be empty'),
});

const contentSchema = z.object({
  content: z.string().min(1, 'content cannot be empty'),
});

const verifySchema = z.object({
  teamId: z.string().uuid('teamId must be a valid UUID'),
  action: z.enum(['Verified', 'Rejected']),
  rejectionNotes: z.string().min(1).optional(),
});

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

const createStageSchema = z.object({
  competitionId: z.string().uuid('competitionId must be a valid UUID'),
  name: z.string().min(1, 'name cannot be empty'),
  startDate: z.string().datetime('startDate must be a valid ISO 8601 datetime'),
  endDate: z.string().datetime('endDate must be a valid ISO 8601 datetime'),
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
// Body: { teamId: string, action: "Verified" | "Rejected", rejectionNotes?: string }
// Security: CommitteeAccount middleware (Admin or Committee role)
// Response: returns updated verification status + full team info
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/stages
// Create a competition stage (e.g. "Preliminary", "Final")
// Body: { competitionId: string, name: string, startDate: string, endDate: string }
// Security: Admin only
// ─────────────────────────────────────────────────────────────────────────────
admin.post(
  '/stages',
  committeeMiddleware({ roles: ['Admin'] }),
  async (c) => {
    const body = await c.req.json();
    const parsed = createStageSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }

    const { competitionId, name, startDate, endDate } = parsed.data;

    if (new Date(endDate) <= new Date(startDate)) {
      return c.json({ error: 'endDate must be after startDate' }, 400);
    }

    const db = createDb(c.env);

    const [competition] = await db
      .select({ id: competitions.id })
      .from(competitions)
      .where(eq(competitions.id, competitionId))
      .limit(1);

    if (!competition) {
      return c.json({ error: 'Competition not found' }, 404);
    }

    const [duplicate] = await db
      .select({ id: competitionStages.id })
      .from(competitionStages)
      .where(
        sql`${competitionStages.competitionId} = ${competitionId} AND lower(${competitionStages.name}) = lower(${name})`,
      )
      .limit(1);

    if (duplicate) {
      return c.json({ error: `A stage named "${name}" already exists for this competition` }, 409);
    }

    const [stage] = await db
      .insert(competitionStages)
      .values({
        competitionId,
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      })
      .returning();

    return c.json({ success: true, stage }, 201);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/stages/:stageId
// Update a stage's name and/or dates after creation.
// Body: { name?, startDate?, endDate? }  — at least one field required
// Security: Admin only
// ─────────────────────────────────────────────────────────────────────────────
admin.put(
  '/stages/:stageId',
  committeeMiddleware({ roles: ['Admin'] }),
  async (c) => {
    const stageId = c.req.param('stageId');

    if (!z.string().uuid().safeParse(stageId).success) {
      return c.json({ error: 'stageId must be a valid UUID' }, 400);
    }

    const body = await c.req.json();
    const parsed = updateStageSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }

    if (!parsed.data.name && !parsed.data.startDate && !parsed.data.endDate) {
      return c.json({ error: 'At least one field (name, startDate, endDate) must be provided' }, 400);
    }

    const db = createDb(c.env);

    const [existing] = await db
      .select({
        id: competitionStages.id,
        competitionId: competitionStages.competitionId,
        startDate: competitionStages.startDate,
        endDate: competitionStages.endDate,
      })
      .from(competitionStages)
      .where(eq(competitionStages.id, stageId))
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Stage not found' }, 404);
    }

    const resolvedStart = parsed.data.startDate ? new Date(parsed.data.startDate) : existing.startDate;
    const resolvedEnd = parsed.data.endDate ? new Date(parsed.data.endDate) : existing.endDate;

    if (resolvedEnd <= resolvedStart) {
      return c.json({ error: 'endDate must be after startDate' }, 400);
    }

    if (parsed.data.name) {
      const [nameDuplicate] = await db
        .select({ id: competitionStages.id })
        .from(competitionStages)
        .where(
          sql`${competitionStages.competitionId} = ${existing.competitionId} AND lower(${competitionStages.name}) = lower(${parsed.data.name}) AND ${competitionStages.id} != ${stageId}`,
        )
        .limit(1);

      if (nameDuplicate) {
        return c.json({ error: `A stage named "${parsed.data.name}" already exists for this competition` }, 409);
      }
    }

    const updateData: Partial<typeof competitionStages.$inferInsert> = {};
    if (parsed.data.name) updateData.name = parsed.data.name;
    if (parsed.data.startDate) updateData.startDate = new Date(parsed.data.startDate);
    if (parsed.data.endDate) updateData.endDate = new Date(parsed.data.endDate);

    const [updated] = await db
      .update(competitionStages)
      .set(updateData)
      .where(eq(competitionStages.id, stageId))
      .returning();

    return c.json({ success: true, stage: updated });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/stages/:stageId/requirements
// Replace all document requirements for a stage.
// Body: { requirements: [{ documentName, allowedExtensions, maxSizeMb, isMandatory? }] }
// Security: Admin only
// ─────────────────────────────────────────────────────────────────────────────
admin.put(
  '/stages/:stageId/requirements',
  committeeMiddleware({ roles: ['Admin'] }),
  async (c) => {
    const stageId = c.req.param('stageId');

    if (!z.string().uuid().safeParse(stageId).success) {
      return c.json({ error: 'stageId must be a valid UUID' }, 400);
    }

    const body = await c.req.json();
    const parsed = setRequirementsSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }

    const db = createDb(c.env);

    const [stage] = await db
      .select({ id: competitionStages.id })
      .from(competitionStages)
      .where(eq(competitionStages.id, stageId))
      .limit(1);

    if (!stage) {
      return c.json({ error: 'Stage not found' }, 404);
    }

    // Full replacement: wipe existing requirements then insert the new set
    await db.delete(stageRequirements).where(eq(stageRequirements.stageId, stageId));

    const inserted = await db
      .insert(stageRequirements)
      .values(
        parsed.data.requirements.map((req) => ({
          stageId,
          documentName: req.documentName,
          allowedExtensions: req.allowedExtensions,
          maxSizeMb: req.maxSizeMb,
          isMandatory: req.isMandatory,
        })),
      )
      .returning();

    return c.json({ success: true, stageId, requirements: inserted });
  },
);

export default admin;
