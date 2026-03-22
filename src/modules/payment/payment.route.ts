import { Hono } from 'hono';
import { eq, desc, and, lt } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { transactions, teamAccounts, competitions, competitionStages } from '../../db/schema.js';
import { logInfo, logError } from '../../middlewares/logger.js';
import type { Env, Variables } from '../../types/index.js';

const payment = new Hono<{ Bindings: Env; Variables: Variables }>();

const TOKEN_VALIDITY_MINUTES = 60;

/**
 * POST /api/payment/token
 * Create or fetch payment transaction record
 */
payment.post('/token', async (c) => {
  const startTime = performance.now();
  const user = c.get('user');
  const db = createDb(c.env);

  try {
    logInfo('payment.token', 'Creating payment token', { userId: user?.id });

    const teamResult = await db.select().from(teamAccounts).where(eq(teamAccounts.id, user.id)).limit(1);

    if (!teamResult || teamResult.length === 0) {
      logError('payment.token', 'Team not found', { userId: user?.id });
      return c.json({ error: 'Team not found' }, 404);
    }

    const team = teamResult[0];
    logInfo('payment.token', `Found team: ${team.teamName}`);

    const competitionResult = await db
      .select()
      .from(competitions)
      .where(eq(competitions.id, team.competitionId))
      .limit(1);

    if (!competitionResult || competitionResult.length === 0) {
      logError('payment.token', 'Competition not found', { competitionId: team.competitionId });
      return c.json({ error: 'Competition not found' }, 404);
    }

    const competition = competitionResult[0];
    const competitionName = competition.name;
    logInfo('payment.token', `Found competition: ${competitionName}`);

    // Calculate dynamic fee based on early bird deadline
    const now = new Date();
    const earlyBirdDeadline = new Date(competition.earlyBirdDeadline);
    const isEarlyBird = now < earlyBirdDeadline;
    const feeAmount = isEarlyBird
      ? parseFloat(competition.earlyBirdFee.toString())
      : parseFloat(competition.normalBirdFee.toString());

    logInfo('payment.token', `Fee calculation - Type: ${isEarlyBird ? 'early_bird' : 'normal'}, Amount: ${feeAmount}`);

    // Check if there's already a pending or verified transaction
    const existingResult = await db
      .select()
      .from(transactions)
      .where(eq(transactions.teamId, team.id))
      .orderBy(desc(transactions.createdAt))
      .limit(1);

    if (existingResult && existingResult.length > 0) {
      const existing = existingResult[0];
      logInfo('payment.token', `Found existing transaction - Status: ${existing.verificationStatus}`);

      // If already verified, return error
      if (existing.verificationStatus === 'Verified') {
        logInfo('payment.token', 'Payment already verified');
        return c.json(
          {
            error: 'Payment already verified',
            orderId: existing.orderId,
            status: 'verified',
            verificationStatus: existing.verificationStatus,
          },
          400
        );
      }

      // If pending, block Mayar payment (they can't pay twice)
      if (existing.verificationStatus === 'Pending') {
        logInfo('payment.token', 'Payment pending verification - blocking new Mayar payment');
        return c.json(
          {
            error: 'Payment already in progress',
            status: 'payment_pending',
            message: 'You already have a payment awaiting verification. Please wait for admin review or contact support.',
            orderId: existing.orderId,
            verificationStatus: 'Pending',
            paymentType: existing.paymentType,
          },
          403 // Forbidden - payment blocked
        );
      }

      // If rejected, allow new payment
      if (existing.verificationStatus === 'Rejected') {
        logInfo('payment.token', 'Previous payment rejected, allowing new transaction');
      }
    } else {
      logInfo('payment.token', 'No existing transactions found');
    }

    // Create new transaction record
    const newOrderId = `WILD-${team.id.slice(0, 8)}-${Date.now()}`;
    logInfo('payment.token', `Creating new transaction - OrderId: ${newOrderId}`);

    await db.insert(transactions).values({
      teamId: team.id,
      orderId: newOrderId,
      amount: feeAmount.toString(),
    });

    logInfo('payment.token', 'Transaction created successfully');
    const duration = performance.now() - startTime;

    return c.json({
      orderId: newOrderId,
      status: 'new_generated',
      message: 'New transaction created',
      amount: feeAmount,
      feeType: isEarlyBird ? 'early_bird' : 'normal',
      competitionName,
    });
  } 
  catch (error) {
    logError('payment.token', 'Error creating payment token', error);
    const duration = performance.now() - startTime;
    return c.json(
      {
        error: 'Failed to generate payment token',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/payment/status
 * Check current payment status for the authenticated user's team
 */
payment.get('/status', async (c) => {
  const startTime = performance.now();
  const user = c.get('user');
  const db = createDb(c.env);

  try {
    logInfo('payment.status', 'Checking payment status', { userId: user?.id });

    const teamResult = await db.select().from(teamAccounts).where(eq(teamAccounts.id, user.id)).limit(1);

    if (!teamResult || teamResult.length === 0) {
      logError('payment.status', 'Team not found', { userId: user?.id });
      return c.json({ error: 'Team not found' }, 404);
    }

    const team = teamResult[0];
    logInfo('payment.status', `Found team: ${team.teamName}`);

    const latestPaymentResult = await db
      .select()
      .from(transactions)
      .where(eq(transactions.teamId, team.id))
      .orderBy(desc(transactions.createdAt))
      .limit(1);

    if (!latestPaymentResult || latestPaymentResult.length === 0) {
      logInfo('payment.status', 'No payment record found');
      const duration = performance.now() - startTime;
      return c.json({
        hasPayment: false,
        message: 'No payment record found',
      });
    }

    const latestPayment = latestPaymentResult[0];
    logInfo('payment.status', `Found payment record - Status: ${latestPayment.verificationStatus}`);

    const duration = performance.now() - startTime;

    return c.json({
      hasPayment: true,
      orderId: latestPayment.orderId,
      amount: latestPayment.amount,
      paymentType: latestPayment.paymentType,
      verificationStatus: latestPayment.verificationStatus,
      verifiedBy: latestPayment.verifiedBy,
      createdAt: latestPayment.createdAt,
      rejectionNotes: latestPayment.rejectionNotes,
    });
  } 
  catch (error) {
    logError('payment.status', 'Error checking payment status', error);
    const duration = performance.now() - startTime;
    return c.json({ error: 'Failed to check payment status' }, 500);
  }
});

/**
 * POST /api/payment/callback
 * Webhook endpoint for Mayar payment notifications
 * Mayar calls this when payment is received
 * 
 * Note: Mayar does not provide webhook signature verification.
 * This endpoint validates the payload structure instead.
 */
payment.post('/callback', async (c) => {
  const startTime = performance.now();
  const db = createDb(c.env);

  try {
    const rawBody = await c.req.text();
    const payload = JSON.parse(rawBody);

    logInfo('payment.webhook', `Processing event: ${payload?.event}`);

    // Only handle payment.received events
    if (payload?.event !== 'payment.received') {
      logInfo('payment.webhook', `Ignoring non-payment event: ${payload?.event}`);
      return c.json({ status: 'ignored', message: `Event type ${payload?.event} not handled` });
    }

    const data = payload.data;

    // Validate required fields
    if (!data?.id || !data?.status || !data?.amount) {
      console.log('[payment.callback] ❌ Missing required fields in payload');
      return c.json({ error: 'Missing required fields' }, 400);
    }

    // Status should be SUCCESS for completed payments
    if (data.status !== 'SUCCESS') {
      console.log('[payment.callback] ⚠️ Payment not successful, status:', data.status);
      return c.json({ status: 'acknowledged', message: 'Payment status not SUCCESS' });
    }

    // Extract our orderId from product description
    // Format: "Biaya lomba Wildcat 2026 - Order: WILD-xxxxx-timestamp"
    let ourOrderId: string = data.id; // Default to Mayar transaction ID
    if (data.productDescription) {
      const match = data.productDescription.match(/Order:\s*(WILD-[^\s]+)/);
      if (match && match[1]) {
        ourOrderId = match[1];
        console.log('[payment.callback] 🔍 Extracted orderId from description:', ourOrderId);
      }
    }

    // Find transaction by our orderId
    const transactionMatches = await db
      .select()
      .from(transactions)
      .where(eq(transactions.orderId, ourOrderId))
      .limit(1);

    if (!transactionMatches || transactionMatches.length === 0) {
      console.log('[payment.callback] ⚠️ No matching transaction found for orderId:', ourOrderId);
      // Still return 200 to acknowledge to Mayar
      return c.json({ status: 'acknowledged', message: 'Transaction not found in our system' });
    }

    const transaction = transactionMatches[0];
    logInfo('payment.webhook', 'Found matching transaction', { 
      transactionId: transaction.id,
      orderId: transaction.orderId,
      currentStatus: transaction.verificationStatus 
    });

    // Update transaction status to Verified
    if (transaction.verificationStatus === 'Verified') {
      logInfo('payment.webhook', 'Transaction already verified, skipping update');
      return c.json({ status: 'success', message: 'Transaction already verified' });
    }

    await db
      .update(transactions)
      .set({
        verificationStatus: 'Verified',
        paymentType: 'Mayar ID',
      })
      .where(eq(transactions.id, transaction.id));

    logInfo('payment.webhook', 'Transaction updated to Verified');

    // Step 2: Auto-register team to the first "Preliminary" stage
    try {
      // Get the team's competition
      const teamData = await db
        .select()
        .from(teamAccounts)
        .where(eq(teamAccounts.id, transaction.teamId))
        .limit(1);

      if (teamData && teamData.length > 0) {
        const team = teamData[0];

        // Get all stages for this competition and find the first one
        // The first stage is determined by the stage name pattern
        // - "Preliminary" comes before "Final"
        // - If multiple preliminary stages exist, use the earliest by startDate
        const allStages = await db
          .select()
          .from(competitionStages)
          .where(eq(competitionStages.competitionId, team.competitionId));

        if (allStages && allStages.length > 0) {
          // Sort stages to get the first one:
          // 1. Preliminary stages first (name contains "Preliminary")
          // 2. Then by startDate (earliest first)
          const preliminaryStages = allStages.filter(s => 
            s.name.toLowerCase().includes('preliminary')
          );
          
          const firstStage = preliminaryStages.length > 0 
            ? preliminaryStages.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0]
            : allStages.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];

          if (firstStage) {
            // Check if team already has a stage assigned
            if (!team.currentStageId) {
              // Register team to first stage
              await db
                .update(teamAccounts)
                .set({ currentStageId: firstStage.id })
                .where(eq(teamAccounts.id, transaction.teamId));

              logInfo('payment.webhook', `Team ${transaction.teamId} registered to stage: ${firstStage.name}`, {
                stageId: firstStage.id,
                stageName: firstStage.name,
                startDate: firstStage.startDate.toISOString(),
              });
            } else {
              logInfo('payment.webhook', `Team ${transaction.teamId} already has a stage assigned, skipping registration`);
            }
          } else {
            logError('payment.webhook', `No stages found for competition ${team.competitionId}`);
          }
        } else {
          logError('payment.webhook', `No stages configured for competition ${team.competitionId}`);
        }
      }
    } catch (stageError) {
      // Log the error but don't fail the webhook - payment is already verified
      logError('payment.webhook', 'Failed to register team to stage', stageError);
    }

    const duration = performance.now() - startTime;

    return c.json({
      status: 'success',
      message: 'Payment verified successfully',
      transactionId: transaction.id,
      orderId: transaction.orderId,
    });
  } 
  catch (error) {
    logError('payment.webhook', 'Error processing webhook', error);
    const duration = performance.now() - startTime;
    
    // Return 200 to acknowledge to Mayar even on error (so it doesn't retry infinitely)
    return c.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Internal error',
      },
      200 // Still return 200 to prevent Mayar retrying
    );
  }
});

/**
 * POST /api/payment/cleanup-expired
 * Manual cleanup endpoint for expired pending transactions
 * Removes transactions that are still pending after 10 minutes
 * 
 * Security: Admin role ONLY (via committeeMiddleware)
 * 
 * Response:
 * {
 *   "status": "success",
 *   "message": "Cleanup completed",
 *   "deletedCount": 5
 * }
 */
payment.post('/cleanup-expired', async (c) => {
  const db = createDb(c.env);
  
  try {
    logInfo('payment.cleanup', 'Starting manual cleanup of expired transactions');
    
    // Calculate the cutoff time (10 minutes ago)
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - 10 * 60 * 1000);

    // Find all pending transactions older than 10 minutes
    const expiredTransactions = await db
      .select({ 
        id: transactions.id, 
        teamId: transactions.teamId, 
        orderId: transactions.orderId,
        createdAt: transactions.createdAt 
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.verificationStatus, 'Pending'),
          lt(transactions.createdAt, cutoffTime)
        )
      );

    if (expiredTransactions.length === 0) {
      logInfo('payment.cleanup', 'No expired transactions found');
      return c.json({
        status: 'success',
        message: 'No expired transactions to clean up',
        deletedCount: 0,
      });
    }

    // Delete each expired transaction
    let deletedCount = 0;
    for (const transaction of expiredTransactions) {
      try {
        await db
          .delete(transactions)
          .where(eq(transactions.id, transaction.id));

        deletedCount++;
        logInfo(
          'payment.cleanup',
          `Deleted expired transaction: ${transaction.orderId}`,
          { 
            transactionId: transaction.id, 
            teamId: transaction.teamId,
            createdAt: transaction.createdAt.toISOString(),
            ageMinutes: Math.round((now.getTime() - transaction.createdAt.getTime()) / 60000)
          }
        );
      } catch (deleteError) {
        logError(
          'payment.cleanup',
          `Failed to delete transaction ${transaction.id}`,
          deleteError
        );
        // Continue with next transaction
      }
    }

    logInfo('payment.cleanup', `Cleanup completed: deleted ${deletedCount} expired transactions`);

    return c.json({
      status: 'success',
      message: `Cleanup completed: deleted ${deletedCount} expired transactions`,
      deletedCount,
      cutoffTime: cutoffTime.toISOString(),
    });
  } catch (error) {
    logError('payment.cleanup', 'Error during manual cleanup', error);
    return c.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Cleanup failed',
      },
      500
    );
  }
});

export default payment;
