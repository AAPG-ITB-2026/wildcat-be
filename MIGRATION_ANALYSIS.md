# Midtrans → Mayar.id Migration Analysis

## Executive Summary

**Verdict: YES, Migration is Feasible with Moderate Changes Required**

Your current Midtrans implementation can be migrated to Mayar.id, but significant refactoring is needed in the payment library and route handler. The core database schema is compatible.

---

## Architecture Comparison

### 1. **Authentication**

| Aspect | Midtrans | Mayar.id |
|--------|----------|----------|
| Method | Basic Auth | Bearer Token |
| Format | `Basic base64(serverKey:)` | `Bearer {apiKey}` |
| Implementation | `createAuthHeader()` | Simple header assignment |
| Complexity | Low | Very Low |

**Change Required:** ✅ **Minor** - Update auth headers

---

### 2. **Transaction Creation Flow**

#### Midtrans
```
POST /snap/v1/transactions (requires Basic Auth)
├── transaction_details: { order_id, gross_amount }
├── customer_details: { first_name, email, phone }
├── item_details: []
├── credit_card: { secure: true }
└── expiry: { unit: "minutes", duration }
```

**Response:**
```json
{
  "token": "snap_token_here",
  "redirect_url": "https://app.sandbox.midtrans.com/snap/v1/..."
}
```

#### Mayar.id
```
POST /payment/create (requires Bearer Token)
├── name (customer name)
├── email
├── mobile
├── amount
├── redirectUrl
├── description
├── expiredAt (ISO 8601 timestamp)
└── NO transaction items structure
```

**Response:**
```json
{
  "id": "payment_id",
  "transaction_id": "transaction_id",
  "link": "https://cacana.mayar.link/invoices/f61oc2tz6j"
}
```

**Change Required:** ✅ **MAJOR** - Completely rewrite `createMayarTransaction()`
- Different endpoint structure
- No item_details support (simplified)
- Different timestamp format (ISO 8601 vs minutes)
- No snap token concept (just redirect link)

---

### 3. **Signature Verification & Webhook Security**

#### Midtrans
```
Signature = SHA512(order_id + status_code + gross_amount + SERVER_KEY)
Verification: Constant-time comparison
Webhook includes: signature_key field
```

#### Mayar.id
```
Webhook Payload Sent:
{
  "event": "payment.received",
  "data": {
    "id": "transaction_id",
    "status": "SUCCESS",
    "transactionStatus": "paid",
    "createdAt": timestamp,
    "updatedAt": timestamp,
    "merchantId": "your_merchant_id",
    "amount": number,
    "customerName": "...",
    "customerEmail": "...",
    "customerMobile": "...",
    "productId": "product_id",
    "productName": "...",
    "productType": "...",
    ...
  }
}
```

**NO signature_key in webhook!**
- Verification via registered webhook URL (dashboard setup)
- Additional security: Check `merchantId` matches your account
- No explicit signature verification required

**Change Required:** ✅ **MAJOR** - Remove signature verification, add merchant ID validation

---

### 4. **Transaction Status Mapping**

#### Midtrans Status Values
- `settlement` ✅ (completed, funds received)
- `capture` ✅ (captured, may have fraud check)
- `pending` ⏳ (awaiting payment)
- `deny` ❌ (denied)
- `cancel` ❌ (cancelled)
- `expire` ⏰ (expired)
- `failure` ❌ (failed)

#### Mayar.id Status Values (from webhook payload)
- `SUCCESS` ✅ (payment completed)
- `status` field in transaction
- `transactionStatus: "paid"` field

**Status Mapping Required:**
```
Mayar.id webhook data.status="SUCCESS" + data.transactionStatus="paid" 
  → Midtrans: "settlement"
```

**Change Required:** ✅ **MODERATE** - Create status mapping logic

---

### 5. **Token Expiry & Regeneration**

#### Midtrans
- Expiry in minutes (UI shows countdown)
- Can cancel pending transactions before expiry
- `cancelTransaction()` endpoint exists
- Token stays valid until expiration or payment

#### Mayar.id
- `expiredAt`: ISO 8601 timestamp (exact datetime)
- No explicit cancel endpoint mentioned in API
- Payment link expires at specified time
- Can re-create new payment link instead of cancelling

**Change Required:** ✅ **MODERATE** - Convert expiry logic to timestamp-based

---

### 6. **Database Compatibility**

#### Current Schema
```typescript
transactions {
  teamId: uuid
  orderId: string          // ← Generic, compatible
  amount: string
  snapToken: string        // ← Rename to paymentLink/paymentToken
  creationTime: timestamp
  expirationTime: timestamp
  transactionStatus: enum  // ← May need new values
  paymentType: string | null
}
```

**Changes Needed:**
- Rename `snapToken` → `paymentLink` (stores the Mayar link instead of snap token)
- Update `transactionStatusEnum` to handle Mayar status values
- Add optional `mayarTransactionId` field to store Mayar's transaction ID

**Change Required:** ✅ **LOW** - Non-breaking schema update

---

## Implementation Changes Required

### Files to Modify

1. **`src/lib/mayar.ts`** (NEW FILE - Replace midtrans.ts)
   - `createMayarTransaction()`
   - `getMayarTransactionStatus()`
   - Remove: `verifyMidtransSignature()` (not needed)
   - Remove: `cancelTransaction()` (create new payment instead)

2. **`src/modules/payment/payment.route.ts`**
   - POST `/token`: Replace Midtrans calls with Mayar
   - GET `/status`: Update status checking logic
   - POST `/callback`: Major rewrite for Mayar webhook structure
   - Remove fraud_status handling (Mayar doesn't have this concept)
   - Add merchant ID validation in callback

3. **`src/db/schema.ts`**
   - Add `transactionStatusEnum` new values if needed
   - Optional: Add `mayarTransactionId` field

---

## Key Differences Summary

| Feature | Midtrans | Mayar.id | Impact |
|---------|----------|----------|--------|
| Auth | Basic Auth | Bearer Token | 🟡 Minor |
| Token Type | Snap Token (string) | Payment Link (URL) | 🟢 Minor |
| Expiry Format | Minutes (int) | ISO 8601 (string) | 🟢 Minor |
| Cancellation | Explicit API | Create new link | 🟠 Moderate |
| Signature Verification | SHA512 required | Not needed | 🟠 Moderate |
| Status Values | 7 different states | SUCCESS/FAILED + transactionStatus | 🟠 Moderate |
| Fraud Detection | fraud_status field | Not available | 🟡 Minor |
| Item Details | Supported | Simplified (name only) | 🟡 Minor |
| Webhook Payload | order_id + status_code | Structured data object | 🟠 Moderate |

---

## Risk Assessment

### ✅ Low Risk
- Database schema remains compatible
- Authentication is simpler in Mayar
- Both systems use webhook notifications

### ⚠️ Medium Risk
- Webhook structure is completely different
- Need to rewrite signature verification logic
- Status codes need mapping
- Expiry format change

### 🔴 High Risk Areas
- **Payment link persistence**: Mayar provides URL instead of token - ensure frontend handles this properly
- **Fraud detection**: Midtrans has built-in fraud detection; Mayar doesn't - may need additional security measures

---

## Migration Checklist

- [ ] Create `src/lib/mayar.ts` with new functions
- [ ] Update `payment.route.ts` to use Mayar endpoints
- [ ] Update webhook callback handler (new payload structure)
- [ ] Register webhook URL in Mayar dashboard
- [ ] Test token generation
- [ ] Test payment flow (sandbox)
- [ ] Test webhook callbacks
- [ ] Remove Midtrans dependencies
- [ ] Update environment variables (MAYAR_API_KEY instead of MIDTRANS_SERVER_KEY)
- [ ] Test team status updates on successful payment
- [ ] Verify database transactions still work correctly

---

## Code Examples (Next Steps)

### Authentication Header
```typescript
// Midtrans
const encoded = btoa(`${serverKey}:`);
const header = `Basic ${encoded}`;

// Mayar.id
const header = `Bearer ${apiKey}`;
```

### Webhook Verification
```typescript
// Midtrans
const isValid = await verifyMidtransSignature(...);

// Mayar.id
const isValid = body.data?.merchantId === c.env.MAYAR_MERCHANT_ID;
```

### Payment Creation
```typescript
// Midtrans response
{ token: "snap_...", redirect_url: "https://..." }

// Mayar.id response
{ link: "https://cacana.mayar.link/invoices/...", transaction_id: "..." }
```

---

## Recommendation

✅ **Proceed with migration** - It's feasible and well-documented in the Mayar API.

**Effort Estimate:** 6-8 hours for development + 2-3 hours for testing
