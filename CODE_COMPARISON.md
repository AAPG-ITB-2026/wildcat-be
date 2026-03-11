# Midtrans vs Mayar.id: Side-by-Side Code Comparison

## 1. Authentication

### Midtrans
```typescript
const createAuthHeader = (serverKey: string): string => {
  const encoded = btoa(`${serverKey}:`);
  return `Basic ${encoded}`;
};

// Usage
headers: {
  'Authorization': createAuthHeader(serverKey),
}
```

### Mayar.id
```typescript
// Much simpler!
headers: {
  'Authorization': `Bearer ${apiKey}`,
}
```

---

## 2. Payment Token Generation

### Midtrans Flow
```typescript
// Request
POST /snap/v1/transactions
{
  "transaction_details": {
    "order_id": "WILD-abc123-1234567890",
    "gross_amount": 100000
  },
  "customer_details": {
    "first_name": "John Doe",
    "email": "john@example.com"
  },
  "item_details": [{
    "id": "comp-123",
    "price": 100000,
    "quantity": 1,
    "name": "Wildcat 2026 Registration"
  }],
  "expiry": {
    "unit": "minutes",
    "duration": 60
  }
}

// Response
{
  "token": "123abc456def",
  "redirect_url": "https://app.sandbox.midtrans.com/snap/v1/..."
}

// Frontend
window.snap.pay(snapToken, {
  onSuccess: (result) => { ... }
});
```

### Mayar.id Flow
```typescript
// Request
POST /payment/create
{
  "name": "John Doe",
  "email": "john@example.com",
  "mobile": "081234567890",
  "amount": 100000,
  "redirectUrl": "https://yoursite.com/payment-success",
  "description": "Wildcat 2026 Registration Fee",
  "expiredAt": "2024-02-29T09:41:09.401Z"
  // NO item_details structure!
}

// Response
{
  "id": "payment-123",
  "transaction_id": "trans-456",
  "link": "https://cacana.mayar.link/invoices/abc123xyz"
}

// Frontend
window.location.href = paymentLink;  // Direct redirect
```

---

## 3. Payment Token Status Check

### Midtrans
```typescript
// After user returns from payment
const response = await fetch(
  `https://app.sandbox.midtrans.com/v2/${orderId}/status`,
  {
    headers: { 'Authorization': createAuthHeader(serverKey) }
  }
);

// Response
{
  "status_code": "200",
  "transaction_status": "settlement" | "pending" | "deny" | "cancel",
  "fraud_status": "accept" | "challenge" | "deny"  // for CC only
}
```

### Mayar.id
```typescript
// Mayar doesn't have a direct status check endpoint!
// You get status updates via webhook only

// Alternative: Query payment by ID (if available)
GET /payment/{transaction_id}

// You rely on webhook for status updates:
{
  "event": "payment.received",
  "data": {
    "id": "transaction-id",
    "status": "SUCCESS",  // or other status
    "transactionStatus": "paid",
    ...
  }
}
```

---

## 4. Webhook Callback Verification

### Midtrans
```typescript
export const verifyMidtransSignature = async (
  serverKey: string,
  orderId: string,
  statusCode: string,
  grossAmount: string,
  receivedSignature: string
): Promise<boolean> => {
  // Compute: SHA512(order_id + status_code + gross_amount + SERVER_KEY)
  const input = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const msgBuffer = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  const computedHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison
  if (computedHex.length !== receivedSignature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computedHex.length; i++) {
    mismatch |= computedHex.charCodeAt(i) ^ receivedSignature.charCodeAt(i);
  }
  return mismatch === 0;
};

// Webhook Handler
payment.post('/callback', async (c) => {
  const body = await c.req.json();
  const isValid = await verifyMidtransSignature(
    c.env.MIDTRANS_SERVER_KEY,
    body.order_id,
    body.status_code,
    body.gross_amount,
    body.signature_key
  );
  
  if (!isValid) return c.json({ error: 'Invalid signature' }, 401);
  
  const status = body.transaction_status; // "settlement", "pending", etc.
  
  if (status === 'settlement' || status === 'capture') {
    // Mark as Paid
  }
});
```

### Mayar.id
```typescript
// NO signature verification needed! 
// Mayar registers your webhook URL in dashboard

// Webhook Payload
{
  "event": "payment.received",
  "data": {
    "id": "57c75c38-d550-44dc-81f9-afa6615cdf5c",
    "status": "SUCCESS",  // only "SUCCESS" or "FAILED"
    "transactionStatus": "paid",
    "createdAt": "2024-02-15T02:19:11.454Z",
    "merchantId": "463a9515-95d7-4bbb-945c-b1285019c019",
    "customerName": "John Wick",
    "customerEmail": "john@example.com",
    "customerMobile": "081234567890",
    "amount": 100000,
    "productId": "prod-123",
    "productName": "Wildcat 2026 Registration"
  }
}

// Webhook Handler - MUCH SIMPLER!
payment.post('/callback', async (c) => {
  const body = await c.req.json();
  
  // Just validate merchant ID
  if (body.data?.merchantId !== c.env.MAYAR_MERCHANT_ID) {
    return c.json({ error: 'Invalid merchant' }, 401);
  }
  
  // Check status
  if (body.data?.status === 'SUCCESS' && body.data?.transactionStatus === 'paid') {
    // Mark as Paid
  }
});
```

---

## 5. Token Expiry & Regeneration

### Midtrans
```typescript
// Expiry in minutes
const expirationTime = new Date(now.getTime() + 60 * 60 * 1000); // 60 minutes from now

// Later, check if still valid
if (lastPayment.transactionStatus === 'pending') {
  const secondsRemaining = Math.floor(
    (expirationTime.getTime() - now.getTime()) / 1000
  );
  
  if (secondsRemaining > 0) {
    return { token: lastPayment.snapToken, secondsRemaining };
  } else {
    // Cancel the old transaction
    await cancelTransaction(serverKey, lastPayment.orderId);
    // Create new one
  }
}

// Cancel endpoint
export const cancelTransaction = async (serverKey: string, orderId: string) => {
  const response = await fetch(
    `https://app.sandbox.midtrans.com/v2/${orderId}/cancel`,
    {
      method: 'POST',
      headers: { 'Authorization': createAuthHeader(serverKey) }
    }
  );
};
```

### Mayar.id
```typescript
// Expiry as ISO 8601 timestamp
const expirationTime = new Date(now.getTime() + 60 * 60 * 1000);
// Store: expirationTime.toISOString() → "2024-02-29T09:41:09.401Z"

// Check if still valid
if (lastPayment.transactionStatus === 'pending') {
  const secondsRemaining = Math.floor(
    (new Date(lastPayment.expirationTime).getTime() - now.getTime()) / 1000
  );
  
  if (secondsRemaining > 0) {
    return { link: lastPayment.paymentLink, secondsRemaining };
  } else {
    // Mayar has no cancel endpoint - just create new payment
    const newPayment = await createMayarTransaction(apiKey, {
      name: team.leadName,
      email: user.email,
      amount: PAYMENT_AMOUNT,
      mobile: team.phoneNumber,
      expiredAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString()
    });
  }
}

// NO cancel endpoint - create new payment instead
```

---

## 6. Transaction Status Mapping

### Midtrans Statuses
```typescript
const MIDTRANS_TERMINAL_STATES = ['settlement', 'capture'];

switch (transaction_status) {
  case 'settlement':
  case 'capture':
    // Payment complete - mark team as Paid
    if (status === 'capture' && fraud_status !== 'accept') {
      // Flagged fraud - don't mark as Paid yet
      break;
    }
    updateTeamStatus('Paid');
    break;
    
  case 'pending':
    // Still waiting for payment
    break;
    
  case 'deny':
  case 'cancel':
  case 'expire':
  case 'failure':
    // Payment failed
    break;
}
```

### Mayar.id Statuses
```typescript
// Mayar only sends two status values:
// status: "SUCCESS" | "FAILED"
// transactionStatus: "paid" | "unpaid" | "created" | ...

if (body.data?.status === 'SUCCESS' && body.data?.transactionStatus === 'paid') {
  // Payment complete - mark team as Paid
  updateTeamStatus('Paid');
} else if (body.data?.status === 'FAILED') {
  // Payment failed
}

// Simpler logic, but less granular information
```

---

## 7. Current Implementation Issues with Mayar

### ❌ Feature Not Available in Mayar
```typescript
// This won't work with Mayar:
if (lastPayment.transactionStatus === 'capture' && fraud_status === 'challenge') {
  // Mayar doesn't provide fraud_status
  // Can't do conditional fraud checks
}
```

### ⚠️ Workaround Needed
```typescript
// Mayar: No item_details in request
// Current: includes competition name, team info in items
// Solution: Store this info locally, include in description only
```

---

## Summary: What Changes

| Aspect | Midtrans | Mayar.id | Rewrite Needed? |
|--------|----------|----------|-----------------|
| Auth Header | ✅ Create function | ✅ Simple string | Yes (simpler) |
| API Call | ✅ POST /snap/v1/transactions | ✅ POST /payment/create | Yes (different payload) |
| Response Handling | ✅ Extract token + url | ✅ Extract link only | Yes |
| Expiry Format | ✅ Minutes (int) | ✅ ISO 8601 string | Yes |
| Signature Verification | ✅ SHA512 hash | ❌ Not needed | Yes (remove) |
| Status Check | ✅ GET /v2/{id}/status | ❌ Webhook only | Yes (rely on webhook) |
| Cancellation | ✅ POST /v2/{id}/cancel | ❌ Create new link | Yes |
| Status Values | ✅ 7 values | ✅ 2 main values | Yes (mapping) |
| Fraud Detection | ✅ fraud_status field | ❌ Not available | N/A (lose feature) |
