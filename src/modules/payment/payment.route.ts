import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { payments, teams } from '../../db/schema.js';
import { createMidtransTransaction, cancelTransaction, verifyMidtransSignature } from '../../lib/midtrans.js';
import type { Env, Variables } from '../../types/index.js';

const payment = new Hono<{ Bindings: Env; Variables: Variables }>();

const TOKEN_VALIDITY_MINUTES = 60;
const PAYMENT_AMOUNT = 100000;

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
    const teamResult = await db.select().from(teams).where(eq(teams.userId, user.id)).limit(1);

    if (!teamResult || teamResult.length === 0) {
      return c.json({ error: 'Team not found' }, 404);
    }

    const team = teamResult[0];

    const lastPaymentResult = await db
      .select()
      .from(payments)
      .where(eq(payments.teamId, team.id))
      .orderBy(desc(payments.creationTime))
      .limit(1);

    const now = new Date();

    if (lastPaymentResult && lastPaymentResult.length > 0) {
      const lastPayment = lastPaymentResult[0];

      if (lastPayment.transactionStatus === 'settlement') {
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
          .update(payments)
          .set({ transactionStatus: 'expire' })
          .where(eq(payments.orderId, lastPayment.orderId));
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
        first_name: team.leaderName,
        email: user.email || '',
      },
      itemDetails: [
        {
          id: team.category,
          price: PAYMENT_AMOUNT,
          quantity: 1,
          name: `Wildcat 2026 - ${team.category}`,
        },
      ],
    });

    await db.insert(payments).values({
      teamId: team.id,
      orderId: newOrderId,
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
    const teamResult = await db.select().from(teams).where(eq(teams.userId, user.id)).limit(1);

    if (!teamResult || teamResult.length === 0) {
      return c.json({ error: 'Team not found' }, 404);
    }

    const team = teamResult[0];

    const latestPaymentResult = await db
      .select()
      .from(payments)
      .where(eq(payments.teamId, team.id))
      .orderBy(desc(payments.creationTime))
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
 * Updates payment status when Midtrans sends notification.
 * Security: every legitimate Midtrans notification includes a signature_key computed as SHA512(order_id + status_code + gross_amount + SERVER_KEY).
 * Requests that fail this check are rejected immediately.
 */
payment.post('/callback', async (c) => {
  const body = await c.req.json();

  try {
    const { order_id, transaction_status, payment_type, signature_key, status_code, gross_amount } = body;

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

    let status: 'settlement' | 'pending' | 'deny' | 'cancel' | 'expire' | 'failure';

    switch (transaction_status) {
      case 'settlement':
        status = 'settlement';
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

    const updated = await db
      .update(payments)
      .set({
        transactionStatus: status,
        paymentType: payment_type || null,
      })
      .where(eq(payments.orderId, order_id))
      .returning();

    if (status === 'settlement' && updated.length > 0) {
      await db
        .update(teams)
        .set({ status: 'Paid' })
        .where(eq(teams.id, updated[0].teamId));
    }

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
