# Security Audit — wildcat-be

> **Scope**: Full backend codebase (`src/`) — routes, middleware, DB schema, lib, environment config
> **Date**: June 2025

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 High | 3 |
| 🟡 Medium | 3 |

---

## 🔴 Critical Findings

### C1 — Payment Webhook Has No Signature Verification

**File**: [payment.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/payment/payment.route.ts#L252-L354)

The `POST /api/payment/callback` endpoint accepts Mayar webhook payloads and marks transactions as `Verified` without **any** cryptographic signature check. An attacker who knows (or guesses) an `orderId` format (`WILD-xxxxx-timestamp`) can forge a payload and mark arbitrary transactions as paid.

```
payload.event === 'payment.received'  // ← only guard
data.status === 'SUCCESS'             // ← trivially spoofable
```

> [!CAUTION]
> This is **actively exploitable** right now. Anyone can send a POST with a crafted JSON body and skip payment entirely.

**Fix**: Verify the `X-Callback-Token` header (or HMAC signature) that Mayar sends against `MAYAR_WEBHOOK_SECRET`. Reject any request that fails the check with `401`.

---

### C2 — [.env](file:///d:/Coding/localrepositories/wildcat-be/.env) Contains Live Production Credentials

**File**: [.env](file:///d:/Coding/localrepositories/wildcat-be/.env)

The [.env](file:///d:/Coding/localrepositories/wildcat-be/.env) file is **versioned** and contains plaintext production secrets:

| Key | Risk |
|-----|------|
| `SUPABASE_SERVICE_ROLE_KEY` | Full admin access to Supabase (bypasses RLS) |
| `XENDIT_SECRET_KEY` | Can create/void charges on the payment account |
| `MAYAR_API_KEY` | Can call Mayar APIs on the organisation's behalf |
| `R2 credentials` | Read/write to all files in Cloudflare R2 |
| `DATABASE_URL` | Direct Postgres connection string |

> [!CAUTION]
> If this repo is (or ever was) pushed to a public remote, **all credentials are compromised** and must be rotated immediately.

**Fix**: (1) Add [.env](file:///d:/Coding/localrepositories/wildcat-be/.env) to [.gitignore](file:///d:/Coding/localrepositories/wildcat-be/.gitignore). (2) Rotate every secret listed above. (3) Run `git filter-branch` or BFG to purge history.

---

### C3 — [adminMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/adminAuth.ts#7-31) Does Not Enforce Admin Role

**File**: [adminAuth.ts](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/adminAuth.ts#L25-L27)

```typescript
if (!committee || !committee.isActive) {          // ← line 25
    return c.json({ error: 'Forbidden' }, 403);
}
// ⚠️  No check: committee.role === 'Admin'
await next();                                      // ← any active committee passes
```

This middleware is used on legacy routes that mount the [admin](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/adminAuth.ts#7-31) sub-router. Because it allows *any* active committee member through, a regular "Committee" user can access admin-only endpoints that import this middleware, such as old [admin.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/admin/admin.route.ts) routes that haven't been migrated to [committeeMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/auth.ts#46-100).

**Fix**: Add `if (committee.role !== 'Admin') return c.json({ error: 'Forbidden' }, 403);` before `next()`.

---

## 🟠 High Findings

### H1 — CORS Allows All Origins (`origin: '*'`)

**File**: [index.ts](file:///d:/Coding/localrepositories/wildcat-be/src/index.ts#L18-L22)

```typescript
app.use('*', cors({
  origin: '*',            // ← allows any origin
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));
```

This means any website can make authenticated requests to your API if the user's browser has a valid session. Combined with cookie-based auth this would be a full CSRF vector. With bearer tokens the risk is reduced but it still violates defense-in-depth.

**Fix**: Restrict `origin` to your actual frontend domains (e.g. `https://wildcat2026.com`). If multiple environments exist, use a function that validates against an allowlist.

---

### H2 — Error Responses Leak Internal Details

**Files**: Multiple — [admin.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/admin/admin.route.ts), [payment.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/payment/payment.route.ts), [transactions.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/transactions/transactions.route.ts), [teams.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/teams/teams.route.ts)

A recurring pattern across `catch` blocks:

```typescript
return c.json(
  { error: 'Failed to …', details: String(error) },
  500,
);
```

`String(error)` can include:
- Full stack traces with file paths
- Database connection strings or query fragments
- Internal table/column names

This is an information disclosure vulnerability that helps an attacker fingerprint the stack, find injection points, or discover internal table names.

**Fix**: Log the full error server-side. Return only a generic message to the client (e.g. `{ error: "Internal server error" }`). Use a request ID to correlate client errors with server logs.

---

### H3 — Landing Routes Skip Validation (No Zod Schemas)

**File**: [landing.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/landing/landing.route.ts#L100-L256)

Registration endpoints (`/register/step1`, `/register/step2`, `/register/complete`) validate fields with only truthiness checks:

```typescript
if (!competitionId || !teamName || !leadName || !institution || !leadMajor) {
  return c.json({ error: 'Missing required fields' }, 400);
}
```

There is **no type/length/format validation** on any field. An attacker can submit:
- Extremely long strings → potential DB column overflow or denial of service
- SQL/script payloads in `teamName`, `leadName` (mitigated by parameterised queries but still bad practice)
- Unexpected types (arrays, objects) that may cause downstream errors

**Fix**: Define Zod schemas for each registration step (similar to what [admin.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/admin/admin.route.ts) and [upload.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/upload/upload.route.ts) already do) and validate with `.safeParse()`.

---

## 🟡 Medium Findings

### M1 — Excessive Console Logging of Sensitive Data

**Files**: Nearly all route files, especially [admin.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/admin/admin.route.ts) and [payment.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/payment/payment.route.ts)

Examples:
- Payment callback logs **full raw payloads** including `customerEmail`, `customerName`, `amount`, `paymentMethod` (line 259)
- Admin routes log user IDs, signed R2 URLs, transaction IDs, and query results
- Error handlers log **full stack traces** to `console.error`

In a Cloudflare Workers environment, these logs are visible in the Workers dashboard and any log drain. Signed URLs in logs are valid for up to 1 hour and could be harvested.

**Fix**: Use a structured logger with log levels. Set `DEBUG`/`TRACE` for development only. Never log full payloads, signed URLs, or PII in production.

---

### M2 — No Rate Limiting on Any Endpoint

**File**: [index.ts](file:///d:/Coding/localrepositories/wildcat-be/src/index.ts)

There is no rate-limiting middleware. Every endpoint is equally susceptible to:
- Brute-force attacks on auth flows
- Denial of service via expensive admin queries (e.g. `GET /api/admin/submissions` does `N×M` DB queries + signed URL generation)
- Webhook replay abuse on `/api/payment/callback`

**Fix**: Add a rate-limiting middleware (e.g. Cloudflare's built-in rate limiting, or `hono-rate-limiter`) at minimum on auth, registration, and payment endpoints.

---

### M3 — [committeeMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/auth.ts#46-100) Accepts Roles from Any Caller Convention

**File**: [committeeAuth.ts](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/committeeAuth.ts#L7-L14)

The middleware checks `roles` against a hardcoded array of strings passed by the caller:

```typescript
committeeMiddleware({ roles: ['Admin', 'Committee'] })
```

This is well-structured, but the role string values are not enforced by a shared enum or constant. If a route accidentally passes `{ roles: ['admin'] }` (lowercase), it would silently deny all access. There's no compile-time protection against this, and no unit test covers role validation.

**Fix**: Export an `enum CommitteeRole { Admin = 'Admin', Committee = 'Committee' }` from a shared location and use it everywhere. Add a unit test that verifies each middleware invocation uses valid roles.

---

## Positive Observations

| Area | Detail |
|------|--------|
| **IDOR protection** | Upload routes correctly scope file operations to the authenticated user's `teamId` |
| **Parameterised queries** | Drizzle ORM prevents SQL injection throughout |
| **Storage access** | R2 signed URLs are time-limited (1 hour) |
| **Zod validation** | Present on admin and upload routes (just missing from landing) |
| **[committeeMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/auth.ts#46-100)** | Properly checks both role and `isActive`, unlike the legacy [adminMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/adminAuth.ts#7-31) |

---

## Recommended Priority Order

| Priority | Finding | Effort |
|----------|---------|--------|
| 1 | C1 — Add webhook signature verification | ~1 hour |
| 2 | C2 — Remove [.env](file:///d:/Coding/localrepositories/wildcat-be/.env) from VCS, rotate secrets | ~30 min |
| 3 | C3 — Fix [adminMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/adminAuth.ts#7-31) role check | ~10 min |
| 4 | H1 — Restrict CORS origins | ~15 min |
| 5 | H2 — Sanitise error responses | ~2 hours |
| 6 | H3 — Add Zod schemas to landing routes | ~1 hour |
| 7 | M1 — Clean up console logging | ~2 hours |
| 8 | M2 — Add rate limiting | ~1 hour |
| 9 | M3 — Enforce role enum | ~30 min |
