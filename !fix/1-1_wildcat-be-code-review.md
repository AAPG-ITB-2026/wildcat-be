# 🔍 Code Review: `wildcat-be`

**Stack:** Hono.js · Cloudflare Workers · Drizzle ORM · Postgres · Supabase Auth · R2/S3

---

## 🔴 Critical Issues

### 1. Duplicate Middleware Registration — [src/index.ts](file:///d:/Coding/localrepositories/wildcat-be/src/index.ts)

[authMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/auth.ts#8-44) is registered **twice** for `/api/landing/*` and `/api/admin/*`. This causes every request to those routes to hit JWT verification and a DB query **twice per request** — doubling latency and DB load.

```typescript
// Lines 21-24 (first registration)
app.use('/api/landing/*', authMiddleware);
app.use('/api/admin/*', authMiddleware);

// Lines 39-40 (DUPLICATE — should be removed)
app.use('/api/landing/*', authMiddleware);
app.use('/api/admin/*', authMiddleware);
```

**Fix:** Remove lines 39–40.

---

    ### 2. No Webhook Signature Verification — `payment.route.ts:252`

    The Mayar payment callback endpoint (`POST /api/payment/callback`) accepts **any unauthenticated POST request** and trusts the payload completely. An attacker can forge a payment webhook, causing transactions to be fraudulently set to `Verified`.

    ```typescript
    payment.post('/callback', async (c) => {
    const payload = await c.req.json();
    // ❌ No signature/HMAC verification!
    if (payload?.event !== 'payment.received') { ... }
    // ...sets verificationStatus = 'Verified'
    ```

    **Fix:** Verify the `X-Mayar-Signature` (or equivalent) header using HMAC-SHA256 with your Mayar webhook secret before processing any payload.

---

### 3. Missing Authorization on Admin Endpoints — `admin.route.ts:689,720`

`PATCH /api/admin/config` and `PUT /api/admin/content/:section` are **completely unprotected** — no [committeeMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/auth.ts#46-100). Any authenticated user (including regular teams) can invoke them.

```typescript
// Line 689 — no committeeMiddleware!
admin.patch('/config', async (c) => {
// Line 720 — no committeeMiddleware!
admin.put('/content/:section', async (c) => {
```

**Fix:** Add [committeeMiddleware({ roles: ['Admin'] })](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/auth.ts#46-100) as second argument.

---

### 4. Wildcard CORS Origin — `src/index.ts:31`

```typescript
origin: '*', // TODO: Restrict to frontend domain(s)
```

CORS is currently set to `*` with `credentials: true`. This combination is invalid per spec and also exposes all endpoints to any origin. The TODO comment has not been addressed.

**Fix:** Replace with specific frontend domain(s) before production deployment.

---

### 5. [adminMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/adminAuth.ts#7-31) Missing `isActive` Check — [src/middlewares/adminAuth.ts](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/adminAuth.ts)

The [adminMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/adminAuth.ts#7-31) verifies the user exists in the committee table but **does not check `isActive`**. Deactivated committee members can still access admin routes.

```typescript
if (!committee) { // ❌ Missing: || !committee.isActive
  return c.json({ error: 'Forbidden...' }, 403);
}
```

**Fix:** Change to `if (!committee || !committee.isActive)`.

---

## 🟠 High Issues

### 6. N+1 Query Problem — `admin.route.ts:611`

The `GET /api/admin/teams` endpoint fetches all teams, then for **each team** individually queries `transactions` and `teamAdministration`. With 100 teams this makes 201 DB queries per request.

```typescript
const teamsWithStatus = await Promise.all(
  teams.map(async (team) => {
    const [latestTransaction] = await db.select()...(team.id); // N queries
    const [docVerification] = await db.select()...(team.id);   // N queries
  })
);
```

**Fix:** Fetch all transactions and administrations in 2 bulk queries, then merge in memory using a `Map`.

---

### 7. Duplicate Export Router Registration — `admin.route.ts:19,677`

```typescript
// Line 19
admin.route('/export', exportRouter);
// ...
// Line 677 — DUPLICATE
admin.route('/export', exportRouter);
```

All export routes are registered twice. Remove one of them.

---

### 8. Excessive `console.log` in Production — Multiple Files

[payment.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/payment/payment.route.ts), [submission.service.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/submissions/submission.service.ts), and others have dozens of `console.log` calls with **sensitive data** (user IDs, team IDs, amounts, full request payloads). This is a security and performance concern on Cloudflare Workers where every log is shipped to the runtime.

```typescript
console.log('[payment.callback] Raw payload:', JSON.stringify(payload, null, 2));
console.log('[payment.token] User ID:', user?.id);
```

**Fix:** Use the existing `logInfo`/`logError` utilities from [middlewares/logger.ts](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/logger.ts) consistently, and remove debug-level logs or gate them behind an environment flag.

---

### 9. Duplicate `console.log` Block — `src/index.ts:59-75`

The route registration log block is copy-pasted verbatim at lines 59–66 and **again** at lines 68–75. This is dead code noise.

---

## 🟡 Medium Issues

### 10. `as any` Type Escape — `upload.service.ts:91`

```typescript
throw new UploadError(
    'INVALID_FILE_SIZE' as unknown as any,  // ❌
```

This defeats TypeScript's type safety. Either add `'INVALID_FILE_SIZE'` to the `UploadErrorCode` union type or use a properly typed constant.

---

### 11. Hardcoded Bucket Name — Multiple Files

The string `'wildcat2026/'` is hardcoded as a bucket prefix in at least 4 places across [upload.service.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/upload/upload.service.ts) and [submission.service.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/submissions/submission.service.ts). If the bucket is ever renamed, it must be changed in all locations.

```typescript
const expectedPrefix = `wildcat2026/${teamId}/`;
const cleanPath = filePath.startsWith('wildcat2026/') ? ...
```

**Fix:** Extract to a shared constant or environment variable.

---

### 12. Magic Number for File Size — `upload.service.ts:88`

```typescript
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit
```

The per-requirement `maxSizeMb` from the DB is already available but is not used here. Upload service enforces a hardcoded 5MB cap regardless of what the admin configured per requirement.

**Fix:** Pass `requirement.maxSizeMb` from the call site rather than hardcoding.

---

### 13. [admin.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/admin/admin.route.ts) God File — 2,496 Lines

The admin module is a single 2,496-line file handling committees, teams, transactions, documents, scores, events, competitions, announcements, and CMS content. This violates the Single Responsibility Principle and makes the file very hard to navigate, test, and maintain.

**Fix:** Split into sub-routers by domain (e.g., `admin.committee.route.ts`, `admin.teams.route.ts`, `admin.scores.route.ts`).

---

### 14. Inconsistent Naming Convention in Schemas

[submission.schema.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/submissions/submission.schema.ts) uses `snake_case` for field names (`requirement_id`, `file_path`, `content_type`) while the rest of the codebase uses `camelCase`. This inconsistency leaks into the API surface.

---

### 15. `as any` in auth Middleware — `auth.ts:40`

```typescript
} as any);
```

The entire user object is cast to `any` when setting it on context variables. This loses type safety in all downstream handlers. The `Variables` type in `types/index.ts` should define the `user` shape explicitly.

---

## 🟢 Positive Observations

| Area | What's Done Well |
|---|---|
| **Architecture** | Clean service/adapter pattern in `submissions` and `upload` modules with proper dependency injection |
| **Path Traversal Prevention** | [validateSubmittedStoragePath](file:///d:/Coding/localrepositories/wildcat-be/src/modules/submissions/submission.service.ts#282-311) correctly checks for `..`, `//`, and absolute path prefixes |
| **Content-Type Enforcement** | Server-side MIME type validation after upload (not just extension check) |
| **Soft Deletes** | Committee members are deactivated, not hard-deleted — preserves audit trail |
| **DB Schema** | Well-structured Drizzle schema with proper FK constraints and enums |
| **Zod Validation** | Consistent use of Zod for request body validation across admin endpoints |
| **Structured Logging** | `logInfo`/`logError` utility exists — just needs more consistent adoption |
| **JWKS Verification** | JWT verified via Supabase JWKS endpoint (not a static secret) |

---

## 📊 Summary Scorecard

| Category | Rating | Key Finding |
|---|---|---|
| **Security** | 🔴 High Risk | No webhook verification, wildcard CORS, missing auth |
| **Performance** | 🟠 Concern | N+1 queries, duplicate middleware overhead |
| **Code Quality** | 🟡 Fair | God file, magic numbers, `as any` escapes |
| **Architecture** | 🟡 Fair | Good patterns exist, inconsistently applied |
| **Tests** | 🟡 Partial | Test directories exist but coverage unclear |
| **Documentation** | 🟢 Good | Extensive inline JSDoc-style comments |

---

## ✅ Action Checklist (Priority Order)

- [ ] **[CRITICAL]** Remove duplicate `authMiddleware` registrations in `index.ts`
- [ ] **[CRITICAL]** Implement Mayar webhook signature/HMAC verification
- [ ] **[CRITICAL]** Add `committeeMiddleware` to `PATCH /config` and `PUT /content/:section`
- [ ] **[CRITICAL]** Fix `adminMiddleware` to check `isActive`
- [ ] **[HIGH]** Fix wildcard CORS origin before production
- [ ] **[HIGH]** Fix N+1 queries in `GET /api/admin/teams`
- [ ] **[HIGH]** Remove duplicate export router in `admin.route.ts`
- [ ] **[HIGH]** Replace production `console.log` calls with structured logger
- [ ] **[MEDIUM]** Extract bucket name to constant/env var
- [ ] **[MEDIUM]** Add `'INVALID_FILE_SIZE'` to `UploadErrorCode` union
- [ ] **[MEDIUM]** Split `admin.route.ts` into domain sub-routers
- [ ] **[MEDIUM]** Fix `as any` cast in `auth.ts` user object
- [ ] **[LOW]** Normalize naming convention to `camelCase` in schemas
- [ ] **[LOW]** Remove duplicate console.log block in `index.ts`
