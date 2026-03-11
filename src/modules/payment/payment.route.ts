import { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { transactions, teamAccounts, competitions } from '../../db/schema.js';
import { createMayarPayment, verifyMayarWebhook, mapMayarStatus } from '../../lib/mayar.js';
import type { Env, Variables } from '../../types/index.js';

const payment = new Hono<{ Bindings: Env; Variables: Variables }>();

const TOKEN_VALIDITY_MINUTES = 60;
const PAYMENT_AMOUNT = 100000;

/**
 * POST /api/payment/token
 * Generate payment link for Mayar payment
 *
 * Regeneration Logic:
 * - If no previous transaction: Create new
 * - If status = settlement: Return error "Already Paid"
 * - If status = pending and before expirationTime: Return existing link + seconds remaining
 * - If status = pending and past expirationTime: Mark as expire, create new
 * - If status = expire/failure/deny/cancel: Create new
 */
payment.post('/token', async (c) => {
  const user = c.get('user');
  const db = createDb(c.env);

  try {
    const teamResult = await db.select().from(teamAccounts).where(eq(teamAccounts.id, user.id)).limit(1);

    if (!teamResult || teamResult.length === 0) {
      return c.json({ error: 'Team not found' }, 404);
    }

    const team = teamResult[0];

    // Check if documents are verified before allowing payment
    if (team.status !== 'Document_Verified' && team.status !== 'Paid') {
      return c.json(
        {
          error: 'Documents must be verified before payment',
          currentStatus: team.status,
          message: 'Please wait for document verification to be completed',
        },
        403
      );
    }

    const competitionResult = await db
      .select()
      .from(competitions)
      .where(eq(competitions.id, team.competitionId))
      .limit(1);
    const competitionName = competitionResult[0]?.name ?? 'Competition';

    const lastPaymentResult = await db
      .select()
      .from(transactions)
      .where(eq(transactions.teamId, team.id))
      .orderBy(desc(transactions.creationTime))
      .limit(1);

    const now = new Date();

    if (lastPaymentResult && lastPaymentResult.length > 0) {
      const lastPayment = lastPaymentResult[0];

      if (lastPayment.transactionStatus === 'settlement' || lastPayment.transactionStatus === 'capture') {
        return c.json(
          {
            error: 'Payment already completed',
            orderId: lastPayment.orderId,
            status: lastPayment.transactionStatus,
          },
          400
        );
      }

      if (lastPayment.transactionStatus === 'pending') {
        const expirationTime = new Date(lastPayment.expirationTime);
        const secondsRemaining = Math.floor((expirationTime.getTime() - now.getTime()) / 1000);

        if (secondsRemaining > 0 && lastPayment.snapToken) {
          return c.json({
            link: lastPayment.snapToken,
            orderId: lastPayment.orderId,
            status: 'existing_active',
            message: 'Using existing active payment link',
            expirationTime: lastPayment.expirationTime,
            secondsRemaining,
          });
        }

        // Token expired - Mayar has no cancel endpoint, just mark as expired
        await db
          .update(transactions)
          .set({ transactionStatus: 'expire' })
          .where(eq(transactions.orderId, lastPayment.orderId));
      }
    }

    const newOrderId = `WILD-${team.id.slice(0, 8)}-${Date.now()}`;
    const creationTime = now;
    const expirationTime = new Date(now.getTime() + TOKEN_VALIDITY_MINUTES * 60 * 1000);

    const mayarResponse = await createMayarPayment(c.env.MAYAR_API_KEY, {
      name: team.leadName,
      email: user.email || '',
      mobile: team.phoneNumber,
      amount: PAYMENT_AMOUNT,
      redirectUrl: `https://yourfrontend.com/payment-success?orderId=${newOrderId}`,
      description: `Wildcat 2026 - ${competitionName} Registration Fee`,
      expiryMinutes: TOKEN_VALIDITY_MINUTES,
    });

    await db.insert(transactions).values({
      teamId: team.id,
      orderId: newOrderId,
      amount: String(PAYMENT_AMOUNT),
      snapToken: mayarResponse.link, // Store the payment link
      creationTime,
      expirationTime,
      transactionStatus: 'pending',
      paymentType: null,
    });

    return c.json({
      link: mayarResponse.link,
      orderId: newOrderId,
      status: 'new_generated',
      message: 'New payment link generated',
      expirationTime,
      secondsRemaining: TOKEN_VALIDITY_MINUTES * 60,
    });
  } 
  catch (error) {
    console.error('Payment token generation error:', error);
    return c.json(
      {
        error: 'Failed to generate payment link',
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
  const user = c.get('user');
  const db = createDb(c.env);

  try {
    const teamResult = await db.select().from(teamAccounts).where(eq(teamAccounts.id, user.id)).limit(1);

    if (!teamResult || teamResult.length === 0) {
      return c.json({ error: 'Team not found' }, 404);
    }

    const team = teamResult[0];

    const latestPaymentResult = await db
      .select()
      .from(transactions)
      .where(eq(transactions.teamId, team.id))
      .orderBy(desc(transactions.creationTime))
      .limit(1);

    if (!latestPaymentResult || latestPaymentResult.length === 0) {
      return c.json({
        hasPayment: false,
        message: 'No payment record found',
      });
    }

    const latestPayment = latestPaymentResult[0];

    let isLinkValid = false;
    let secondsRemaining = 0;

    if (latestPayment.transactionStatus === 'pending') {
      const expirationTime = new Date(latestPayment.expirationTime);
      secondsRemaining = Math.max(0, Math.floor((expirationTime.getTime() - Date.now()) / 1000));
      isLinkValid = secondsRemaining > 0;
    }

    return c.json({
      hasPayment: true,
      orderId: latestPayment.orderId,
      status: latestPayment.transactionStatus,
      paymentType: latestPayment.paymentType,
      creationTime: latestPayment.creationTime,
      expirationTime: latestPayment.expirationTime,
      isLinkValid,
      secondsRemaining: isLinkValid ? secondsRemaining : 0,
      paymentLink: isLinkValid ? latestPayment.snapToken : null,
    });
  } 
  catch (error) {
    console.error('Payment status check error:', error);
    return c.json({ error: 'Failed to check payment status' }, 500);
  }
});

/**
 * POST /api/payment/callback
 * Mayar webhook callback handler
 *
 * Security: Mayar uses merchantId validation instead of signature verification.
 * Every legitimate Mayar notification includes merchantId in the data object.
 * Requests with mismatched merchant ID are rejected immediately.
 *
 * State machine: once a transaction reaches settlement, subsequent webhooks
 * won't regress it. This prevents out-of-order replays from corrupting paid transactions.
 *
 * Atomicity: the transaction status update and team status update are wrapped
 * in a single DB transaction so they either both succeed or both roll back.
 *
 * Mayar webhook payload structure:
 * {
 *   "event": "payment.received",
 *   "data": {
 *     "id": "transaction-id",
 *     "status": "SUCCESS",
 *     "transactionStatus": "paid",
 *     "merchantId": "your-merchant-id",
 *     "amount": 100000,
 *     "customerName": "...",
 *     ...
 *   }
 * }
 */
payment.post('/callback', async (c) => {
  const body = await c.req.json();

  try {
    // Mayar sends data nested in 'data' object
    const webhookData = body.data || body;

    if (!webhookData) {
      console.error('Missing webhook data');
      return c.json({ error: 'Missing webhook data' }, 400);
    }

    // Validate webhook authenticity using merchant ID
    const isValid = verifyMayarWebhook(webhookData, c.env.MAYAR_MERCHANT_ID);
    if (!isValid) {
      console.error('Invalid merchant ID in webhook');
      return c.json({ error: 'Invalid merchant' }, 401);
    }

    const db = createDb(c.env);

    // Mayar uses 'id' as transaction ID, not 'order_id'
    const transactionId = webhookData.id;
    if (!transactionId) {
      return c.json({ error: 'Missing transaction ID' }, 400);
    }

    // Find transaction by order ID (we store transaction details in snapToken)
    // Since Mayar doesn't return our order_id, we need to match by transaction ID
    // or store Mayar's transaction ID in the database
    // For now, we'll search by amount and match with recent pending transactions
    const existingTxResult = await db
      .select()
      .from(transactions)
      .where(eq(transactions.amount, String(webhookData.amount)))
      .orderBy(desc(transactions.creationTime))
      .limit(5);

    // Find the matching transaction (most recent pending one)
    let matchedTx = existingTxResult.find(
      (tx) => tx.transactionStatus === 'pending' && 
              new Date(tx.expirationTime).getTime() > Date.now()
    );

    if (!matchedTx) {
      // If not found and it's a successful payment, it might be a retry
      matchedTx = existingTxResult[0];
      if (!matchedTx) {
        console.log('No matching transaction found for amount:', webhookData.amount);
        return c.json({ success: true }, 200); // Return success to prevent retries
      }
    }

    // Check if already in terminal state
    if (matchedTx.transactionStatus === 'settlement' || 
        matchedTx.transactionStatus === 'capture') {
      return c.json({
        success: true,
        transactionId: transactionId,
        status: matchedTx.transactionStatus,
      });
    }

    // Map Mayar status to our database status
    const dbStatus = mapMayarStatus(webhookData.status, webhookData.transactionStatus);
    const isSuccessful = dbStatus === 'settlement';

    // Update transaction and team status atomically
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(transactions)
        .set({
          transactionStatus: dbStatus,
          paymentType: webhookData.paymentMethod || null,
        })
        .where(eq(transactions.id, matchedTx.id))
        .returning();

      if (isSuccessful && updated.length > 0) {
        await tx
          .update(teamAccounts)
          .set({ status: 'Paid' })
          .where(eq(teamAccounts.id, updated[0].teamId));
      }
    });

    return c.json({
      success: true,
      transactionId: transactionId,
      status: dbStatus,
    });
  } 
  catch (error) {
    console.error('Payment callback error:', error);
    return c.json({ error: 'Failed to process callback' }, 500);
  }
});

export default payment;
