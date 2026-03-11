# Environment Setup for Mayar Payment Integration

## Quick Checklist

- [ ] Get Mayar API Key
- [ ] Get Mayar Merchant ID
- [ ] Update `wrangler.toml`
- [ ] Test with Mayar Sandbox
- [ ] Register webhook URL in Mayar Dashboard

---

## Step 1: Get Mayar Credentials

### Sandbox (Recommended for testing)
1. Go to https://web.mayar.club
2. Sign up or log in
3. Navigate to: **Integration** → **API Keys**
4. Click "Create API Key" or copy existing key
5. Copy your **API Key** and **Merchant ID** (visible in dashboard)

**Sandbox Base URL**: `https://api.mayar.club/hl/v1`

### Production (after testing)
1. Go to https://mayar.id
2. Navigate to: **Integration** → **API Keys**
3. Create or copy your API Key
4. Get your **Merchant ID**

**Production Base URL**: `https://api.mayar.id/hl/v1`

---

## Step 2: Update `wrangler.toml`

```toml
# wrangler.toml

name = "wildcat-be"
type = "service"

# ... existing config ...

[env.development]
# Mayar Sandbox Environment
vars = { MAYAR_BASE_URL = "https://api.mayar.club/hl/v1" }
secrets = ["MAYAR_API_KEY", "MAYAR_MERCHANT_ID"]

# Legacy (if keeping Midtrans for fallback)
# secrets = ["MIDTRANS_SERVER_KEY"]

[env.production]
# Mayar Production Environment
vars = { MAYAR_BASE_URL = "https://api.mayar.id/hl/v1" }
secrets = ["MAYAR_API_KEY", "MAYAR_MERCHANT_ID"]
```

---

## Step 3: Set Local Development Secrets

Create a `.dev.vars` file in your project root:

```env
# .dev.vars (NEVER commit this file!)

# Mayar
MAYAR_API_KEY=your_api_key_here
MAYAR_MERCHANT_ID=your_merchant_id_here

# Existing secrets
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_key
DATABASE_URL=your_database_url
```

**⚠️ IMPORTANT**: Add `.dev.vars` to `.gitignore`

---

## Step 4: Set Production Secrets (Cloudflare)

Run these commands to set production secrets:

```bash
# Set Mayar API Key
wrangler secret put MAYAR_API_KEY

# Set Mayar Merchant ID
wrangler secret put MAYAR_MERCHANT_ID

# Verify secrets are set
wrangler secret list
```

You'll be prompted to enter the values. Copy-paste them carefully.

---

## Step 5: Register Webhook URL in Mayar Dashboard

### Sandbox Webhook Setup
1. Log in to https://web.mayar.club
2. Go to: **Integration** → **Webhook**
3. In "URL Webhook" field, enter your callback URL:
   ```
   https://your-backend-domain.com/api/payment/callback
   ```
   Or for local testing with ngrok:
   ```
   https://your-ngrok-url.ngrok.io/api/payment/callback
   ```
4. Click **Save**
5. Click **Test** to verify the URL is reachable
6. You should see a success response

### Production Webhook Setup (same process, production environment)
1. Log in to https://mayar.id
2. Follow same steps
3. Use your production domain URL

---

## Local Testing with ngrok

If testing locally, you need to expose your local server to the internet:

```bash
# Install ngrok (if not already installed)
# https://ngrok.com/download

# Start your local server (usually port 8787 for Wrangler)
wrangler dev

# In another terminal, expose it with ngrok
ngrok http 8787

# You'll get a URL like: https://abc123.ngrok.io

# Use this URL for webhook: https://abc123.ngrok.io/api/payment/callback
```

---

## Testing the Integration

### 1. Generate Payment Link

```bash
curl -X POST http://localhost:8787/api/payment/token \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "link": "https://cacana.mayar.link/invoices/abc123xyz",
  "orderId": "WILD-xxx-123456",
  "status": "new_generated",
  "secondsRemaining": 3600
}
```

### 2. Complete Test Payment

1. Go to the payment link in the response
2. Use Mayar's test payment methods (check dashboard for available options)
3. Complete the payment
4. Mayar will redirect to your `redirectUrl`

### 3. Verify Webhook Received

Check your application logs for webhook callback:

```
[LOG] Payment callback received
[LOG] Webhook data: { id: "trans-123", status: "SUCCESS", ... }
[LOG] Team status updated to Paid
```

---

## Environment Variables Summary

| Variable | Source | Required | Example |
|----------|--------|----------|---------|
| `MAYAR_API_KEY` | Mayar Dashboard → API Keys | ✅ Yes | `sk_live_abc123...` |
| `MAYAR_MERCHANT_ID` | Mayar Dashboard | ✅ Yes | `merchant_123abc...` |
| `SUPABASE_URL` | Supabase Dashboard | ✅ Yes | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase Dashboard | ✅ Yes | `eyJ...` |
| `DATABASE_URL` | From Supabase | ✅ Yes | `postgresql://...` |
| `MIDTRANS_SERVER_KEY` | (Optional, for rollback) | ❌ No | `Mid-...` |

---

## Troubleshooting

### "MAYAR_API_KEY does not exist"
- Check `.dev.vars` file exists and is properly formatted
- Verify file is in project root, not in `src/`
- Restart `wrangler dev`

### "Webhook URL not reachable"
- Make sure your local server is running (`wrangler dev`)
- If testing locally, use ngrok to expose the server
- Check that ngrok URL is correct in Mayar dashboard
- Verify endpoint path: `/api/payment/callback`

### "Invalid merchant ID in webhook"
- Double-check `MAYAR_MERCHANT_ID` value
- Ensure it matches exactly what's in Mayar dashboard
- No extra spaces or quotes

### "Payment link returns 500 error"
- Check that `MAYAR_API_KEY` is correct
- Verify Mayar is reachable (not blocked by firewall)
- Check application logs for detailed error message

---

## Next Steps

1. ✅ Set up environment variables
2. ✅ Register webhook URL in Mayar dashboard
3. ✅ Start `wrangler dev`
4. ✅ Test payment generation
5. ✅ Complete test payment
6. ✅ Verify webhook received
7. ✅ Check team status updated to "Paid"
8. ✅ Deploy to production

---

## Getting Help

- Mayar API Docs: https://docs.mayar.id/
- Mayar Support: support@mayar.id
- Check Mayar webhook history: Dashboard → Integration → Webhook
