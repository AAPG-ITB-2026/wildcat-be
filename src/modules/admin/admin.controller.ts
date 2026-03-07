import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../../db/index.js';
import {
  appConfig,
  appContent,
  announcements,
  competitionStages,
} from '../../db/schema.js';
import { getStorage } from '../../infrastructure/storage/get-storage.js';
import type { Env, Variables } from '../../types/index.js';
import {
  adminReviewPaginationQuerySchema,
  releaseScoresParamsSchema,
  stageSubmissionsParamsSchema,
} from './admin.schema.js';
import {
  listAdministrationVerificationReviews,
  listPaymentVerificationReviews,
  listStageSubmissionReviews,
} from './admin.service.js';
import type { AdminReviewServiceDeps } from './admin.types.js';
import { createDrizzleAdminReviewRepo } from './adapters/drizzle-admin-review.adapter.js';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const configSchema = z.object({
  key: z.enum(['RELEASE_SCORES', 'MAINTENANCE_MODE']),
  value: z.enum(['true', 'false']),
});

const contentSchema = z.object({
  content: z.string().min(1, 'content cannot be empty'),
});

const announcementSchema = z.object({
  title: z.string().min(1, 'title cannot be empty'),
  content: z.string().min(1, 'content cannot be empty'),
  targetAudience: z.enum(['All', 'Paper_Poster', 'BCC', 'GnG', 'HighSchool']),
  attachmentUrl: z.string().url().optional(),
  scheduledFor: z.string().datetime().optional(),
});

function buildReviewDeps(env: Env): AdminReviewServiceDeps {
  const db = createDb(env);

  return {
    storage: getStorage(env),
    reviews: createDrizzleAdminReviewRepo(db),
  };
}

function handleReviewError(c: AppContext, error: unknown) {
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

function parsePaginationQuery(c: AppContext) {
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

  return paginationQuery.data;
}

export const handlePatchConfig = async (c: AppContext) => {
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
};

export const handlePutContent = async (c: AppContext) => {
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
};

export const handlePostAnnouncement = async (c: AppContext) => {
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
};

export const handleGetTransactions = async (c: AppContext) => {
  try {
    const parsedPagination = parsePaginationQuery(c);
    if (parsedPagination instanceof Response) {
      return parsedPagination;
    }

    const data = await listPaymentVerificationReviews(buildReviewDeps(c.env), parsedPagination);
    return c.json({ success: true, data }, 200);
  } catch (error) {
    return handleReviewError(c, error);
  }
};

export const handleGetAdministrationTeams = async (c: AppContext) => {
  try {
    const parsedPagination = parsePaginationQuery(c);
    if (parsedPagination instanceof Response) {
      return parsedPagination;
    }

    const data = await listAdministrationVerificationReviews(
      buildReviewDeps(c.env),
      parsedPagination,
    );

    return c.json({ success: true, data }, 200);
  } catch (error) {
    return handleReviewError(c, error);
  }
};

export const handleGetStageSubmissions = async (c: AppContext) => {
  try {
    const parsedPagination = parsePaginationQuery(c);
    if (parsedPagination instanceof Response) {
      return parsedPagination;
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
    const data = await listStageSubmissionReviews(stageId, buildReviewDeps(c.env), parsedPagination);

    return c.json({ success: true, data }, 200);
  } catch (error) {
    return handleReviewError(c, error);
  }
};

export const handlePatchReleaseScores = async (c: AppContext) => {
  const stageParams = releaseScoresParamsSchema.safeParse(c.req.param());
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
  const db = createDb(c.env);

  const [updatedStage] = await db
    .update(competitionStages)
    .set({ isScoresReleased: true })
    .where(eq(competitionStages.id, stageId))
    .returning({
      stageId: competitionStages.id,
      stageName: competitionStages.name,
      isScoresReleased: competitionStages.isScoresReleased,
    });

  if (!updatedStage) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Stage not found',
        },
      },
      404,
    );
  }

  return c.json({ success: true, data: updatedStage }, 200);
};
