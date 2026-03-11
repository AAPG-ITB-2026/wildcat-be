import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { transactions, teamAccounts, competitions } from '../../db/schema.js';
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
    console.log('[payment.token] ===== START POST /token =====');
    console.log('[payment.token] User ID:', user?.id);

    const teamResult = await db.select().from(teamAccounts).where(eq(teamAccounts.id, user.id)).limit(1);

    if (!teamResult || teamResult.length === 0) {
      console.log('[payment.token] ❌ Team not found for user:', user?.id);
      return c.json({ error: 'Team not found' }, 404);
    }

    const team = teamResult[0];
    console.log('[payment.token] ✅ Found team:', {
      teamId: team.id,
      teamName: team.teamName,
      competitionId: team.competitionId,
    });

    const competitionResult = await db
      .select()
      .from(competitions)
      .where(eq(competitions.id, team.competitionId))
      .limit(1);

    if (!competitionResult || competitionResult.length === 0) {
      console.log('[payment.token] ❌ Competition not found:', team.competitionId);
      return c.json({ error: 'Competition not found' }, 404);
    }

    const competition = competitionResult[0];
    const competitionName = competition.name;
    console.log('[payment.token] ✅ Found competition:', {
      competitionId: competition.id,
      competitionName: competitionName,
      earlyBirdFee: competition.earlyBirdFee,
      normalBirdFee: competition.normalBirdFee,
      earlyBirdDeadline: competition.earlyBirdDeadline,
    });

    // Calculate dynamic fee based on early bird deadline
    const now = new Date();
    const earlyBirdDeadline = new Date(competition.earlyBirdDeadline);
    const isEarlyBird = now < earlyBirdDeadline;
    const feeAmount = isEarlyBird
      ? parseFloat(competition.earlyBirdFee.toString())
      : parseFloat(competition.normalBirdFee.toString());

    console.log('[payment.token] 💰 Fee calculation:', {
      currentTime: now.toISOString(),
      earlyBirdDeadline: earlyBirdDeadline.toISOString(),
      isEarlyBird,
      feeAmount,
      feeType: isEarlyBird ? 'early_bird' : 'normal',
    });

    // Check if there's already a pending or verified transaction
    const existingResult = await db
      .select()
      .from(transactions)
      .where(eq(transactions.teamId, team.id))
      .orderBy(desc(transactions.createdAt))
      .limit(1);

    if (existingResult && existingResult.length > 0) {
      const existing = existingResult[0];
      console.log('[payment.token] 📋 Found existing transaction:', {
        transactionId: existing.id,
        orderId: existing.orderId,
        amount: existing.amount,
        verificationStatus: existing.verificationStatus,
        paymentType: existing.paymentType,
        createdAt: existing.createdAt,
      });

      // If already verified, return error
      if (existing.verificationStatus === 'Verified') {
        console.log('[payment.token] ⚠️ Payment already verified');
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
        console.log('[payment.token] 🚫 Payment pending verification - blocking new Mayar payment', {
          existingPaymentType: existing.paymentType,
          message: 'User cannot create another payment while one is pending',
        });
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
        console.log('[payment.token] ❌ Previous payment rejected, allowing new transaction');
      }
    } else {
      console.log('[payment.token] 📭 No existing transactions found');
    }

    // Create new transaction record
    const newOrderId = `WILD-${team.id.slice(0, 8)}-${Date.now()}`;
    console.log('[payment.token] 🆕 Creating new transaction:', { orderId: newOrderId });

    await db.insert(transactions).values({
      teamId: team.id,
      orderId: newOrderId,
      amount: feeAmount.toString(),
    });

    console.log('[payment.token] ✅ Transaction created successfully');
    const duration = performance.now() - startTime;
    console.log(`[payment.token] ===== SUCCESS (${Math.round(duration)}ms) =====`);

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
    console.error('[payment.token] ❌ Error:', error);
    const duration = performance.now() - startTime;
    console.log(`[payment.token] ===== FAILED (${Math.round(duration)}ms) =====`);
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
    console.log('[payment.status] ===== START GET /status =====');
    console.log('[payment.status] User ID:', user?.id);

    const teamResult = await db.select().from(teamAccounts).where(eq(teamAccounts.id, user.id)).limit(1);

    if (!teamResult || teamResult.length === 0) {
      console.log('[payment.status] ❌ Team not found for user:', user?.id);
      return c.json({ error: 'Team not found' }, 404);
    }

    const team = teamResult[0];
    console.log('[payment.status] ✅ Found team:', team.teamName);

    const latestPaymentResult = await db
      .select()
      .from(transactions)
      .where(eq(transactions.teamId, team.id))
      .orderBy(desc(transactions.createdAt))
      .limit(1);

    if (!latestPaymentResult || latestPaymentResult.length === 0) {
      console.log('[payment.status] 📭 No payment record found');
      const duration = performance.now() - startTime;
      console.log(`[payment.status] ===== NO PAYMENT (${Math.round(duration)}ms) =====`);
      return c.json({
        hasPayment: false,
        message: 'No payment record found',
      });
    }

    const latestPayment = latestPaymentResult[0];
    console.log('[payment.status] ✅ Found payment record:', {
      transactionId: latestPayment.id,
      orderId: latestPayment.orderId,
      amount: latestPayment.amount,
      verificationStatus: latestPayment.verificationStatus,
      paymentType: latestPayment.paymentType,
      hasProof: !!latestPayment.paymentProofUrl,
      verifiedBy: latestPayment.verifiedBy,
      createdAt: latestPayment.createdAt,
      rejectionNotes: latestPayment.rejectionNotes,
    });

    const duration = performance.now() - startTime;
    console.log(`[payment.status] ===== SUCCESS (${Math.round(duration)}ms) =====`);

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
    console.error('[payment.status] ❌ Error:', error);
    const duration = performance.now() - startTime;
    console.log(`[payment.status] ===== FAILED (${Math.round(duration)}ms) =====`);
    return c.json({ error: 'Failed to check payment status' }, 500);
  }
});

/**
 * POST /api/payment/callback
 * Webhook endpoint for Mayar payment notifications
 * Mayar calls this when payment is received
 */
payment.post('/callback', async (c) => {
  const startTime = performance.now();
  const db = createDb(c.env);

  try {
    const payload = await c.req.json();
    console.log('[payment.callback] ===== START POST /callback =====');
    console.log('[payment.callback] Raw payload:', JSON.stringify(payload, null, 2));
    console.log('[payment.callback] Event:', payload?.event);
    console.log('[payment.callback] Webhook payload received:', {
      event: payload?.event,
      transactionId: payload?.data?.id,
      status: payload?.data?.status,
      amount: payload?.data?.amount,
      customerEmail: payload?.data?.customerEmail,
      customerName: payload?.data?.customerName,
      productDescription: payload?.data?.productDescription,
    });

    // Only handle payment.received events
    if (payload?.event !== 'payment.received') {
      console.log('[payment.callback] ⚠️ Ignoring non-payment event:', payload?.event);
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
    console.log('[payment.callback] ✅ Found matching transaction:', {
      transactionId: transaction.id,
      teamId: transaction.teamId,
      orderId: transaction.orderId,
      currentStatus: transaction.verificationStatus,
    });

    // Update transaction status to Verified
    if (transaction.verificationStatus === 'Verified') {
      console.log('[payment.callback] ℹ️ Transaction already verified, skipping update');
      return c.json({ status: 'success', message: 'Transaction already verified' });
    }

    await db
      .update(transactions)
      .set({
        verificationStatus: 'Verified',
        paymentType: 'Mayar ID',
      })
      .where(eq(transactions.id, transaction.id));

    console.log('[payment.callback] ✅ Transaction updated to Verified');
    console.log('[payment.callback] Payment details:', {
      orderId: transaction.orderId,
      amount: data.amount,
      transactionId: data.id,
      paymentMethod: data.paymentMethod,
      updatedAt: new Date().toISOString(),
    });

    const duration = performance.now() - startTime;
    console.log(`[payment.callback] ===== SUCCESS (${Math.round(duration)}ms) =====`);

    return c.json({
      status: 'success',
      message: 'Payment verified successfully',
      transactionId: transaction.id,
      orderId: transaction.orderId,
    });
  } 
  catch (error) {
    console.error('[payment.callback] ❌ Error processing webhook:', error);
    const duration = performance.now() - startTime;
    console.log(`[payment.callback] ===== FAILED (${Math.round(duration)}ms) =====`);
    
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

export default payment;
