# Mayar.id Migration - Implementation Roadmap

## Overview
This is a step-by-step guide to migrate your payment system from Midtrans to Mayar.id.

---

## Phase 1: Preparation

### Step 1: Set Up Mayar Account
1. Go to https://web.mayar.club (sandbox) or https://mayar.id (production)
2. Create account and verify email
3. Generate API Key from dashboard → Integration → API Keys
4. Note your Merchant ID (from dashboard)

### Step 2: Environment Setup
```bash
# Update .env or wrangler.toml
MAYAR_API_KEY=your_api_key_here
MAYAR_MERCHANT_ID=your_merchant_id_here
MAYAR_BASE_URL=https://api.mayar.club/hl/v1  # sandbox
# OR
MAYAR_BASE_URL=https://api.mayar.id/hl/v1    # production
```

### Step 3: Register Webhook URL
1. In Mayar dashboard, go to Integration → Webhook
2. Enter your webhook URL: `https://yourbackend.com/api/payment/callback`
3. Click "Test" to verify it's reachable
4. Save

---

## Phase 2: Create Mayar Library

### Create `src/lib/mayar.ts`

```typescript
const IS_PRODUCTION = false; // Set to true for production
const BASE_URL = IS_PRODUCTION
  ? 'https://api.mayar.id/hl/v1'
  : 'https://api.mayar.club/hl/v1';

interface CreatePaymentParams {
  name: string;
  email: string;
  mobile: string;
  amount: number;
  redirectUrl: string;
  description: string;
  expiryMinutes: number;
}

interface MayarResponse {
  id: string;
  transaction_id: string;
  transactionId: string;
  link: string;
}

/**
 * Create a payment link on Mayar
 */
export const createMayarPayment = async (
  apiKey: string,
  params: CreatePaymentParams
): Promise<MayarResponse> => {
  const expirationTime = new Date(
    Date.now() + params.expiryMinutes * 60 * 1000
  );

  const payload = {
    name: params.name,
    email: params.email,
    mobile: params.mobile,
    amount: params.amount,
    redirectUrl: params.redirectUrl,
    description: params.description,
    expiredAt: expirationTime.toISOString(),
  };

  const response = await fetch(`${BASE_URL}/payment/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Mayar Error:', error);
    throw new Error(`Failed to create Mayar payment: ${response.status}`);
  }

  const data = (await response.json()) as MayarResponse;
  return data;
};

/**
 * Get payment status by transaction ID
 * Note: Mayar doesn't provide a status check endpoint
 * We rely on webhook notifications instead
 */
export const getMayarPaymentStatus = async (
  apiKey: string,
  transactionId: string
): Promise<any> => {
  // This endpoint may not exist in Mayar
  // You should rely on webhook callbacks instead
  try {
    const response = await fetch(
      `${BASE_URL}/payment/${transactionId}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get payment status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.log('Note: Direct status check not available, use webhooks:', error);
    return null;
  }
};

/**
 * Validate webhook from Mayar
 * Mayar doesn't use signature verification
 * Instead, validate the merchantId matches your account
 */
export const verifyMayarWebhook = (
  merchantId: string,
  yourMerchantId: string
): boolean => {
  return merchantId === yourMerchantId;
};
```

---

## Phase 3: Update Payment Route

### Update `src/modules/payment/payment.route.ts`

Key changes:
1. Replace all Midtrans imports with Mayar
2. Update POST `/token` endpoint
3. Update POST `/callback` endpoint
4. Update database field references

```typescript
import { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { transactions, teamAccounts, competitions } from '../../db/schema.js';
import { createMayarPayment, verifyMayarWebhook } from '../../lib/mayar.js';
import type { Env, Variables } from '../../types/index.js';

const payment = new Hono<{ Bindings: Env; Variables: Variables }>();

const TOKEN_VALIDITY_MINUTES = 60;
const PAYMENT_AMOUNT = 100000;

/**
 * POST /api/payment/token
 * Generate payment link for Mayar
 */
payment.post('/token', async (c) => {
  const user = c.get('user');
  const db = createDb(c.env);

  try {
    const teamResult = await db
      .select()
      .from(teamAccounts)
      .where(eq(teamAccounts.id, user.id))
      .limit(1);

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

    // Check if already paid
    if (lastPaymentResult && lastPaymentResult.length > 0) {
      const lastPayment = lastPaymentResult[0];

      if (lastPayment.transactionStatus === 'settlement' ||
          lastPayment.transactionStatus === 'capture') {
        return c.json(
          {
            error: 'Payment already completed',
            orderId: lastPayment.orderId,
            status: lastPayment.transactionStatus,
          },
          400
        );
      }

      // Check if pending token is still valid
      if (lastPayment.transactionStatus === 'pending') {
        const expirationTime = new Date(lastPayment.expirationTime);
        const secondsRemaining = Math.floor(
          (expirationTime.getTime() - now.getTime()) / 1000
        );

        if (secondsRemaining > 0 && lastPayment.snapToken) {
          return c.json({
            link: lastPayment.snapToken, // Mayar stores the payment link here
            orderId: lastPayment.orderId,
            status: 'existing_active',
            message: 'Using existing active payment link',
            expirationTime: lastPayment.expirationTime,
            secondsRemaining,
          });
        }

        // Token expired, update status
        await db
          .update(transactions)
          .set({ transactionStatus: 'expire' })
          .where(eq(transactions.orderId, lastPayment.orderId));
      }
    }

    // Create new payment link
    const newOrderId = `WILD-${team.id.slice(0, 8)}-${Date.now()}`;
    const creationTime = now;
    const expirationTime = new Date(
      now.getTime() + TOKEN_VALIDITY_MINUTES * 60 * 1000
    );

    const mayarResponse = await createMayarPayment(
      c.env.MAYAR_API_KEY,
      {
        name: team.leadName,
        email: user.email || '',
        mobile: team.phoneNumber,
        amount: PAYMENT_AMOUNT,
        redirectUrl: `https://yourfrontend.com/payment-success?orderId=${newOrderId}`,
        description: `Wildcat 2026 - ${competitionName} Registration Fee`,
        expiryMinutes: TOKEN_VALIDITY_MINUTES,
      }
    );

    // Store in database
    // Note: snapToken field now stores the payment link
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
  } catch (error) {
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
 * Check payment status for authenticated user's team
 */
payment.get('/status', async (c) => {
  const user = c.get('user');
  const db = createDb(c.env);

  try {
    const teamResult = await db
      .select()
      .from(teamAccounts)
      .where(eq(teamAccounts.id, user.id))
      .limit(1);

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
      secondsRemaining = Math.max(
        0,
        Math.floor((expirationTime.getTime() - Date.now()) / 1000)
      );
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
  } catch (error) {
    console.error('Payment status check error:', error);
    return c.json({ error: 'Failed to check payment status' }, 500);
  }
});

/**
 * POST /api/payment/callback
 * Mayar webhook callback handler
 *
 * Webhook payload:
 * {
 *   "event": "payment.received",
 *   "data": {
 *     "id": "transaction-id",
 *     "status": "SUCCESS",
 *     "transactionStatus": "paid",
 *     "merchantId": "your-merchant-id",
 *     "amount": 100000,
 *     ...
 *   }
 * }
 */
payment.post('/callback', async (c) => {
  const body = await c.req.json();

  try {
    // Validate merchant ID (Mayar's security mechanism)
    if (!body.data?.merchantId) {
      return c.json(
        { error: 'Missing merchant ID' },
        400
      );
    }

    const isValid = verifyMayarWebhook(
      body.data.merchantId,
      c.env.MAYAR_MERCHANT_ID
    );

    if (!isValid) {
      return c.json({ error: 'Invalid merchant' }, 401);
    }

    const db = createDb(c.env);
    
    // Find transaction by amount and customer email
    // Since Mayar doesn't return order_id in webhook, we need to match by details
    // Better: store Mayar's transaction ID and query by that
    const transactionStatus = body.data?.transactionStatus;
    const status = body.data?.status; // "SUCCESS" or "FAILED"

    if (status === 'SUCCESS' && transactionStatus === 'paid') {
      // Mark as settlement (Mayar equivalent of Midtrans settlement)
      await db.transaction(async (tx) => {
        // Find transaction by amount + email
        const matchingTx = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.amount, String(body.data.amount)),
              // You may need to adjust this query based on your needs
            )
          )
          .limit(1);

        if (matchingTx.length > 0) {
          const updated = await tx
            .update(transactions)
            .set({
              transactionStatus: 'settlement',
              paymentType: body.data?.paymentMethod || null,
            })
            .where(eq(transactions.id, matchingTx[0].id))
            .returning();

          if (updated.length > 0) {
            // Mark team as Paid
            await tx
              .update(teamAccounts)
              .set({ status: 'Paid' })
              .where(eq(teamAccounts.id, updated[0].teamId));
          }
        }
      });
    }

    return c.json({
      success: true,
      status: status,
      transactionStatus: transactionStatus,
    });
  } catch (error) {
    console.error('Payment callback error:', error);
    return c.json({ error: 'Failed to process callback' }, 500);
  }
});

export default payment;
```

---

## Phase 4: Database Updates (Optional but Recommended)

### Update `src/db/schema.ts`

```typescript
export const transactions = pgTable("transactions", {
  // ... existing fields ...
  
  // Rename snapToken to paymentLink for clarity (optional)
  // OR keep snapToken but it now stores payment URL instead of token
  snapToken: text("snap_token"), // Now stores Mayar payment link URL
  
  // Optional: add Mayar transaction ID for better matching
  mayarTransactionId: varchar("mayar_transaction_id", { length: 255 }),
  
  // Rest of fields remain the same
  // ...
});
```

---

## Phase 5: Testing Checklist

- [ ] **Sandbox Testing**
  - [ ] Generate payment link in sandbox
  - [ ] Verify link is clickable and redirects to Mayar
  - [ ] Complete test payment in Mayar sandbox
  - [ ] Verify webhook is called
  - [ ] Verify team status updates to "Paid"

- [ ] **Edge Cases**
  - [ ] Test token expiration
  - [ ] Test creating new token while old one is pending
  - [ ] Test invalid merchant ID in webhook
  - [ ] Test expired payment link

- [ ] **Error Handling**
  - [ ] Test network timeout
  - [ ] Test invalid API key
  - [ ] Test webhook retry logic

---

## Phase 6: Deployment

### Pre-deployment
1. Get production Mayar API key
2. Update `MAYAR_BASE_URL` to production
3. Register production webhook URL in Mayar dashboard
4. Test in Mayar production sandbox first

### Deploy
1. Update environment variables in production
2. Deploy new code
3. Monitor webhook logs
4. Test with real payment

---

## Important Notes

### ⚠️ Data Migration
- Existing transactions from Midtrans won't have Mayar data
- Consider how to handle this transition period
- May want to grandfather old transactions as "grandfathered"

### 📊 Monitoring
- Set up logging for webhook failures
- Monitor Mayar webhook retry history
- Keep error logs for debugging

### 🔐 Security
- Mayar registers webhook URL in dashboard (more secure than IP whitelist)
- No signature verification needed (Mayar handles it)
- Still validate merchantId in webhook

### 🎯 Testing Payments
- Use sandbox until fully tested
- Have test cards ready: Mayar provides test payment methods
- Test refund flow (if needed)

---

## Rollback Plan

If migration doesn't work:
1. Keep Midtrans library in separate file
2. Create feature flag to switch between Mayar and Midtrans
3. Can switch back quickly if needed

```typescript
if (c.env.USE_MAYAR === 'true') {
  // Use Mayar
} else {
  // Use Midtrans
}
```

---

## Next Steps

1. ✅ Review this migration plan
2. ✅ Coordinate with team on timeline
3. ✅ Set up Mayar sandbox account
4. ✅ Implement changes in development
5. ✅ Test thoroughly
6. ✅ Deploy to production
