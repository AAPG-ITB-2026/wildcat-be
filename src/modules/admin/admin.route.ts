import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { createDb } from '../../db/index.js';
import {
  appConfig,
  appContent,
  announcements,
} from '../../db/schema.js';
import { getStorage } from '../../infrastructure/storage/get-storage.js';
import type { Env, Variables } from '../../types/index.js';
import {
  adminReviewPaginationQuerySchema,
  stageSubmissionsParamsSchema,
} from './admin.schema.js';
import {
  listAdministrationVerificationReviews,
  listPaymentVerificationReviews,
  listStageSubmissionReviews,
} from './admin.service.js';
import type { AdminReviewServiceDeps } from './admin.types.js';
import { createDrizzleAdminReviewRepo } from './adapters/drizzle-admin-review.adapter.js';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

function buildReviewDeps(env: Env): AdminReviewServiceDeps {
  const db = createDb(env);

  return {
    storage: getStorage(env),
    reviews: createDrizzleAdminReviewRepo(db),
  };
}

function handleReviewError(c: Context<{ Bindings: Env; Variables: Variables }>, error: unknown) {
  console.error('[admin-review] Unexpected error:', error);

  return c.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    },
    500,
  );
}

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
// GET /api/admin/transactions
// Committee review list for payment verifications.
// ─────────────────────────────────────────────────────────────────────────────
admin.get('/transactions', async (c) => {
  try {
    const paginationQuery = adminReviewPaginationQuerySchema.safeParse(c.req.query());
    if (!paginationQuery.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: z.flattenError(paginationQuery.error).fieldErrors,
          },
        },
        400,
      );
    }

    const data = await listPaymentVerificationReviews(buildReviewDeps(c.env), paginationQuery.data);

    return c.json({ success: true, data }, 200);
  } catch (error) {
    return handleReviewError(c, error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/teams/administration
// Committee review list for administration documents.
// ─────────────────────────────────────────────────────────────────────────────
admin.get('/teams/administration', async (c) => {
  try {
    const paginationQuery = adminReviewPaginationQuerySchema.safeParse(c.req.query());
    if (!paginationQuery.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: z.flattenError(paginationQuery.error).fieldErrors,
          },
        },
        400,
      );
    }

    const data = await listAdministrationVerificationReviews(
      buildReviewDeps(c.env),
      paginationQuery.data,
    );

    return c.json({ success: true, data }, 200);
  } catch (error) {
    return handleReviewError(c, error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/stages/:stage_id/submissions
// Committee review list for stage submissions.
// ─────────────────────────────────────────────────────────────────────────────
admin.get('/stages/:stage_id/submissions', async (c) => {
  try {
    const paginationQuery = adminReviewPaginationQuerySchema.safeParse(c.req.query());
    if (!paginationQuery.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: z.flattenError(paginationQuery.error).fieldErrors,
          },
        },
        400,
      );
    }

    const stageParams = stageSubmissionsParamsSchema.safeParse(c.req.param());
    if (!stageParams.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid route parameters',
            details: z.flattenError(stageParams.error).fieldErrors,
          },
        },
        400,
      );
    }

    const { stage_id: stageId } = stageParams.data;
    const data = await listStageSubmissionReviews(
      stageId,
      buildReviewDeps(c.env),
      paginationQuery.data,
    );

    return c.json({ success: true, data }, 200);
  } catch (error) {
    return handleReviewError(c, error);
  }
});

export default admin;
