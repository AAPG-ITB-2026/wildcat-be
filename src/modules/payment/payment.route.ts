import { Hono } from 'hono';
import { eq, desc, and, notInArray } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { transactions, teamAccounts, competitions } from '../../db/schema.js';
import { createMidtransTransaction, cancelTransaction, verifyMidtransSignature } from '../../lib/midtrans.js';
import type { Env, Variables } from '../../types/index.js';

const payment = new Hono<{ Bindings: Env; Variables: Variables }>();

const TOKEN_VALIDITY_MINUTES = 60;
const PAYMENT_AMOUNT = 100000;
const TERMINAL_STATES = ['settlement', 'capture'] as const;

/**
 * POST /api/payment/token
 * Generate Snap Token for Midtrans payment
 *
 * Regeneration Logic:
 * - If no previous transaction: Create new
 * - If status = settlement: Return error "Already Paid"
 * - If status = pending and before expirationTime: Return existing token + seconds remaining
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
            token: lastPayment.snapToken,
            orderId: lastPayment.orderId,
            status: 'existing_active',
            message: 'Using existing active token',
            expirationTime: lastPayment.expirationTime,
            secondsRemaining,
          });
        }

        await cancelTransaction(c.env.MIDTRANS_SERVER_KEY, lastPayment.orderId);

        await db
          .update(transactions)
          .set({ transactionStatus: 'expire' })
          .where(eq(transactions.orderId, lastPayment.orderId));
      }
    }

    const newOrderId = `WILD-${team.id.slice(0, 8)}-${Date.now()}`;
    const creationTime = now;
    const expirationTime = new Date(now.getTime() + TOKEN_VALIDITY_MINUTES * 60 * 1000);

    const snapResponse = await createMidtransTransaction(c.env.MIDTRANS_SERVER_KEY, {
      orderId: newOrderId,
      grossAmount: PAYMENT_AMOUNT,
      expiryMinutes: TOKEN_VALIDITY_MINUTES,
      customerDetails: {
        first_name: team.leadName,
        email: user.email || '',
      },
      itemDetails: [
        {
          id: team.competitionId,
          price: PAYMENT_AMOUNT,
          quantity: 1,
          name: `Wildcat 2026 - ${competitionName}`,
        },
      ],
    });

    await db.insert(transactions).values({
      teamId: team.id,
      orderId: newOrderId,
      amount: String(PAYMENT_AMOUNT),
      snapToken: snapResponse.token,
      creationTime,
      expirationTime,
      transactionStatus: 'pending',
      paymentType: null,
    });

    return c.json({
      token: snapResponse.token,
      orderId: newOrderId,
      status: 'new_generated',
      message: 'New payment token generated',
      redirectUrl: snapResponse.redirect_url,
      expirationTime,
      secondsRemaining: TOKEN_VALIDITY_MINUTES * 60,
    });
  } 
  catch (error) {
    console.error('Payment token generation error:', error);
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

    let isTokenValid = false;
    let secondsRemaining = 0;

    if (latestPayment.transactionStatus === 'pending') {
      const expirationTime = new Date(latestPayment.expirationTime);
      secondsRemaining = Math.max(0, Math.floor((expirationTime.getTime() - Date.now()) / 1000));
      isTokenValid = secondsRemaining > 0;
    }

    return c.json({
      hasPayment: true,
      orderId: latestPayment.orderId,
      status: latestPayment.transactionStatus,
      paymentType: latestPayment.paymentType,
      creationTime: latestPayment.creationTime,
      expirationTime: latestPayment.expirationTime,
      isTokenValid,
      secondsRemaining: isTokenValid ? secondsRemaining : 0,
      snapToken: isTokenValid ? latestPayment.snapToken : null,
    });
  } 
  catch (error) {
    console.error('Payment status check error:', error);
    return c.json({ error: 'Failed to check payment status' }, 500);
  }
});

/**
 * POST /api/payment/callback
 * Midtrans webhook callback handler
 *
 * Security: every legitimate Midtrans notification includes a signature_key
 * computed as SHA512(order_id + status_code + gross_amount + SERVER_KEY).
 * Requests that fail this check are rejected immediately.
 *
 * State machine: once a transaction reaches a terminal state (settlement or
 * capture), no subsequent webhook can regress it. This prevents out-of-order
 * replays from corrupting paid transactions.
 *
 * Atomicity: the transaction status update and team status update are wrapped
 * in a single DB transaction so they either both succeed or both roll back.
 *
 * fraud_status: for credit-card captures, Midtrans sends a fraud_status field.
 * Only captures with fraud_status "accept" (or absent) mark the team as Paid.
 * Captures flagged as "challenge" or "deny" are recorded but the team stays
 * unpaid until manual review or a follow-up settlement notification.
 */
payment.post('/callback', async (c) => {
  const body = await c.req.json();

  try {
    const { order_id, transaction_status, payment_type, fraud_status, signature_key, status_code, gross_amount } = body;

    if (!signature_key || !status_code || !gross_amount) {
      return c.json({ error: 'Missing required signature fields' }, 401);
    }

    const isValid = await verifyMidtransSignature(
      c.env.MIDTRANS_SERVER_KEY,
      order_id ?? '',
      status_code,
      gross_amount,
      signature_key
    );

    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    if (!order_id) {
      return c.json({ error: 'Missing order_id' }, 400);
    }

    const db = createDb(c.env);

    const existingTx = await db
      .select()
      .from(transactions)
      .where(eq(transactions.orderId, order_id))
      .limit(1);

    if (
      existingTx.length > 0 &&
      TERMINAL_STATES.includes(existingTx[0].transactionStatus as typeof TERMINAL_STATES[number])
    ) {
      return c.json({
        success: true,
        orderId: order_id,
        status: existingTx[0].transactionStatus,
      });
    }

    let status: 'settlement' | 'pending' | 'deny' | 'cancel' | 'expire' | 'failure' | 'capture';

    switch (transaction_status) {
      case 'settlement':
        status = 'settlement';
        break;
      case 'capture':
        status = 'capture';
        break;
      case 'pending':
        status = 'pending';
        break;
      case 'deny':
        status = 'deny';
        break;
      case 'cancel':
        status = 'cancel';
        break;
      case 'expire':
        status = 'expire';
        break;
      case 'failure':
        status = 'failure';
        break;
      default:
        status = 'pending';
    }

    const isCaptureAccepted = status === 'capture' && (!fraud_status || fraud_status === 'accept');
    const isSuccessful = status === 'settlement' || isCaptureAccepted;

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(transactions)
        .set({
          transactionStatus: status,
          paymentType: payment_type || null,
        })
        .where(
          and(
            eq(transactions.orderId, order_id),
            notInArray(transactions.transactionStatus, ['settlement', 'capture'])
          )
        )
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
      orderId: order_id,
      status: status,
    });
  } 
  catch (error) {
    console.error('Payment callback error:', error);
    return c.json({ error: 'Failed to process callback' }, 500);
  }
});

export default payment;
