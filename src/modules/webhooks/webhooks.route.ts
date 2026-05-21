import { Hono } from 'hono';
import { createDb } from '../../db/index.js';
import { events, eventRegistrationLogs } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../../types/index.js';

const webhooks = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/webhooks/events/:id/register
 * 
 * External Webhook Receiver for Event Registration (Google Forms Integration)
 * 
 * Description:
 *   This endpoint receives webhooks from Google Forms (via Apps Script) when
 *   a user submits a registration for a side event. It executes a single
 *   database transaction that:
 *   1. INSERTs a row into event_registration_logs for analytics tracking
 *   2. UPDATEs the events table to increment registered_count by 1
 * 
 * Security:
 *   - Requires x-webhook-secret header matching WEBHOOK_SECRET env var
 *   - Rejects unauthenticated requests with 401
 *   - Prevents registration spam by validating the secret
 * 
 * Request:
 *   Headers: { "x-webhook-secret": "your-secret" }
 *   Body: {
 *     "timestamp": "2026-03-15T12:00:00Z",
 *     "formResponses": { "Email": ["user@example.com"], ... },
 *     "rawRow": ["column1", "column2", ...]
 *   }
 * 
 * Response:
 *   {
 *     "success": true,
 *     "message": "Registration recorded",
 *     "eventId": "uuid",
 *     "logId": "uuid",
 *     "newRegisteredCount": 42
 *   }
 * 
 * Error Responses:
 *   - 401: Invalid/missing webhook secret
 *   - 404: Event not found
 *   - 500: Database transaction error
 * ─────────────────────────────────────────────────────────────────────────────
 */
webhooks.post('/events/:id/register', async (c) => {
  const startTime = Date.now();
  const eventId = c.req.param('id');
  
  console.log(`[webhooks.events.register] ===== START POST /events/${eventId}/register =====`);

  try {
    // 1. Validate webhook secret
    const webhookSecret = c.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[webhooks.events.register] WEBHOOK_SECRET not configured in environment');
      return c.json(
        { error: 'Webhook configuration error' },
        500,
      );
    }

    const providedSecret = c.req.header('x-webhook-secret');
    if (!providedSecret || providedSecret !== webhookSecret) {
      console.warn(
        '[webhooks.events.register] Unauthorized webhook attempt for event',
        eventId,
      );
      return c.json(
        { error: 'Invalid or missing webhook secret' },
        401,
      );
    }

    console.log(`[webhooks.events.register] ✓ Webhook secret validated`);

    // 2. Parse request body
    const body = await c.req.json();
    console.log(`[webhooks.events.register] Received payload:`, {
      timestamp: body.timestamp,
      hasFormResponses: !!body.formResponses,
      rawRowLength: body.rawRow?.length || 0,
    });

    // 3. Create database connection and start transaction
    const db = createDb(c.env);
    console.log(`[webhooks.events.register] Starting database transaction...`);

    // 4. Verify event exists
    const [eventExists] = await db
      .select({ id: events.id, registeredCount: events.registeredCount })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (!eventExists) {
      console.error(`[webhooks.events.register] Event not found: ${eventId}`);
      return c.json(
        { error: 'Event not found' },
        404,
      );
    }

    console.log(
      `[webhooks.events.register] ✓ Event exists | Current registeredCount: ${eventExists.registeredCount}`,
    );

    // 5. Execute atomic transaction: INSERT log + UPDATE count
    console.log(`[webhooks.events.register] Executing atomic transaction...`);
    
    let logEntry: any;
    let updatedEvent: any;

    await db.transaction(async (tx) => {
      // Insert log entry
      const [insertedLog] = await tx
        .insert(eventRegistrationLogs)
        .values({
          eventId,
          createdAt: new Date(body.timestamp || new Date().toISOString()),
        })
        .returning({ id: eventRegistrationLogs.id });

      logEntry = insertedLog;
      console.log(`[webhooks.events.register] ✓ Log inserted | logId: ${logEntry.id}`);

      // Update event count
      const [updated] = await tx
        .update(events)
        .set({
          registeredCount: eventExists.registeredCount + 1,
        })
        .where(eq(events.id, eventId))
        .returning({ registeredCount: events.registeredCount });

      updatedEvent = updated;
      console.log(
        `[webhooks.events.register] ✓ Event count updated | newCount: ${updatedEvent.registeredCount}`,
      );
    });

    const duration = Date.now() - startTime;
    console.log(
      `[webhooks.events.register] ===== SUCCESS (${duration}ms) =====`,
    );

    return c.json(
      {
        success: true,
        message: 'Registration recorded',
        eventId,
        logId: logEntry.id,
        newRegisteredCount: updatedEvent.registeredCount,
      },
      200,
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[webhooks.events.register] ===== ERROR (${duration}ms) =====`);
    console.error('[webhooks.events.register] Error details:', error);
    if (error instanceof Error) {
      console.error('[webhooks.events.register] Stack:', error.stack);
    }

    return c.json(
      {
        error: 'Failed to record registration',
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

export default webhooks;
