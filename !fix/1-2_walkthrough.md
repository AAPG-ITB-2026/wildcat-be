# Walkthrough: Critical & High Issue Fixes

**Date:** 2026-03-12 · **Files changed:** 3 · **Tests:** 126/150 pass (24 pre-existing failures)

---

## Changes Made

### Fix 1 — Remove Duplicate [authMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/auth.ts#8-44)

#### [index.ts](file:///d:/Coding/localrepositories/wildcat-be/src/index.ts)

```diff:index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import landing from './modules/landing/landing.route.js';
import admin from './modules/admin/admin.route.js';
import payment from './modules/payment/payment.route.js';
import upload from './modules/upload/upload.route.js';
import assets from './modules/assets/assets.route.js';
import submissions from './modules/submissions/submission.route.js';
import transactionsRoute from './modules/transactions/transaction.route.js';
import { authMiddleware } from './middlewares/auth.js';
import type { Env, Variables } from './types/index.js';
import { adminMiddleware } from './middlewares/adminAuth.js';
import { announcementRoutes } from './modules/announcements/announcements.route.js';
import { logger } from './middlewares/logger.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Security Hardening (NF01)
app.use('*', secureHeaders());
app.use('/api/landing/*', authMiddleware);
app.use('/api/admin/*', authMiddleware);
app.use('/api/payment/token', authMiddleware);
app.use('/api/payment/status', authMiddleware);

// 2. Logger (Capture all requests for debugging)
app.use('*', logger);

// 2. CORS (WAJIB di atas Auth Middleware agar Preflight OPTIONS lolos)
app.use('*', cors({
    origin: '*', // TODO: Restrict to frontend domain(s) nanti saat production
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'], // Tambahkan OPTIONS dan PATCH
    allowHeaders: ['Content-Type', 'Authorization'], // Wajib ada agar frontend bisa kirim Token
    exposeHeaders: ['Content-Length'],
    credentials: true,
}));

// 3. Auth (Hanya pasang 1 kali saja di sini)
app.use('/api/landing/*', authMiddleware);
app.use('/api/admin/*', authMiddleware);
app.use('/api/admin/*', adminMiddleware); // Admin middleware dieksekusi setelah authMiddleware
app.use('/api/upload/*', authMiddleware);
app.use('/api/submissions/*', authMiddleware);
app.use('/api/transactions/*', authMiddleware);

// 4. Health Check (For Docker/PM2 - BE-15)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 5. Mount Modules
app.route('/api/landing', landing);
app.route('/api/admin', admin);
app.route('/api/payment', payment);
app.route('/api/announcements', announcementRoutes);
app.route('/api/assets', assets);
app.route('/api/upload', upload);
app.route('/api/submissions', submissions);
app.route('/api/transactions', transactionsRoute);

console.log('[app.init] Routes registered:');
console.log('  - /api/landing/*');
console.log('  - /api/admin/*');
console.log('  - /api/announcements/*');
console.log('  - /api/assets/*');
console.log('  - /api/upload/* (POST /sign, POST /confirm, GET /:teamId/:documentType)');
console.log('  - /api/submissions/* (POST /request-url, POST /, GET /:requirementId)');
console.log('  - /api/transactions/* (POST /request-url, POST /submit-proof)');

console.log('[app.init] Routes registered:');
console.log('  - /api/landing/*');
console.log('  - /api/admin/*');
console.log('  - /api/announcements/*');
console.log('  - /api/assets/*');
console.log('  - /api/upload/* (POST /sign, POST /confirm, GET /:teamId/:documentType)');
console.log('  - /api/submissions/* (POST /request-url, POST /, GET /:requirementId)');

// 6. Start Server
export default app;
===
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import landing from './modules/landing/landing.route.js';
import admin from './modules/admin/admin.route.js';
import payment from './modules/payment/payment.route.js';
import upload from './modules/upload/upload.route.js';
import assets from './modules/assets/assets.route.js';
import submissions from './modules/submissions/submission.route.js';
import transactionsRoute from './modules/transactions/transaction.route.js';
import { authMiddleware } from './middlewares/auth.js';
import type { Env, Variables } from './types/index.js';
import { adminMiddleware } from './middlewares/adminAuth.js';
import { announcementRoutes } from './modules/announcements/announcements.route.js';
import { logger } from './middlewares/logger.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Security Hardening (NF01)
app.use('*', secureHeaders());
app.use('/api/landing/*', authMiddleware);
app.use('/api/admin/*', authMiddleware);
app.use('/api/payment/token', authMiddleware);
app.use('/api/payment/status', authMiddleware);

// 2. Logger (Capture all requests for debugging)
app.use('*', logger);

// 2. CORS (WAJIB di atas Auth Middleware agar Preflight OPTIONS lolos)
app.use('*', cors({
    origin: '*', // TODO: Restrict to frontend domain(s) nanti saat production
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'], // Tambahkan OPTIONS dan PATCH
    allowHeaders: ['Content-Type', 'Authorization'], // Wajib ada agar frontend bisa kirim Token
    exposeHeaders: ['Content-Length'],
    credentials: true,
}));

// 3. Auth
app.use('/api/admin/*', adminMiddleware);
app.use('/api/upload/*', authMiddleware);
app.use('/api/submissions/*', authMiddleware);
app.use('/api/transactions/*', authMiddleware);

// 4. Health Check (For Docker/PM2 - BE-15)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 5. Mount Modules
app.route('/api/landing', landing);
app.route('/api/admin', admin);
app.route('/api/payment', payment);
app.route('/api/announcements', announcementRoutes);
app.route('/api/assets', assets);
app.route('/api/upload', upload);
app.route('/api/submissions', submissions);
app.route('/api/transactions', transactionsRoute);

console.log('[app.init] Routes registered:');
console.log('  - /api/landing/*');
console.log('  - /api/admin/*');
console.log('  - /api/announcements/*');
console.log('  - /api/assets/*');
console.log('  - /api/upload/* (POST /sign, POST /confirm, GET /:teamId/:documentType)');
console.log('  - /api/submissions/* (POST /request-url, POST /, GET /:requirementId)');
console.log('  - /api/transactions/* (POST /request-url, POST /submit-proof)');

// 6. Start Server
export default app;
```

**What:** Removed duplicate `app.use('/api/landing/*', authMiddleware)` and `app.use('/api/admin/*', authMiddleware)` at lines 39–40. These were exact copies of lines 21–22, causing double JWT verification and a redundant DB query per request.

**Effect:** Every request to `/api/landing/*` and `/api/admin/*` now runs [authMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/auth.ts#8-44) exactly once instead of twice.

---

### Fix 2 — Protect `PATCH /config` and `PUT /content/:section`

#### [admin.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/admin/admin.route.ts)

```diff
-admin.patch('/config', async (c) => {
+admin.patch('/config', committeeMiddleware({ roles: ['Admin'] }), async (c) => {

-admin.put('/content/:section', async (c) => {
+admin.put('/content/:section', committeeMiddleware({ roles: ['Admin'] }), async (c) => {
```

**What:** Both endpoints were accessible to any authenticated user (including regular teams). Now restricted to Admin-role committee members only.

---

### Fix 3 — [adminMiddleware](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/adminAuth.ts#7-31) `isActive` Check

#### [adminAuth.ts](file:///d:/Coding/localrepositories/wildcat-be/src/middlewares/adminAuth.ts)

```diff:adminAuth.ts
import type { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/index.js';
import { committeeAccounts } from '../db/schema.js';
import type { Env, Variables } from '../types/index.js';

export const adminMiddleware = async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const user = c.get('user');
    const db = createDb(c.env);

    // Verify the user exists in the committee table
    const [committee] = await db
        .select({ role: committeeAccounts.role })
        .from(committeeAccounts)
        .where(eq(committeeAccounts.id, user.id))
        .limit(1);

    // Console log for debugging
    console.log('[adminMiddleware]', {
        uid: user.id,
        role: committee?.role ?? 'N/A',
        foundInTable: !!committee,
    });

    if (!committee) {
        return c.json({ error: 'Forbidden: Requires committee access' }, 403);
    }

    await next();
};
===
import type { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/index.js';
import { committeeAccounts } from '../db/schema.js';
import type { Env, Variables } from '../types/index.js';

export const adminMiddleware = async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const user = c.get('user');
    const db = createDb(c.env);

    // Verify the user exists in the committee table
    const [committee] = await db
        .select({ role: committeeAccounts.role, isActive: committeeAccounts.isActive })
        .from(committeeAccounts)
        .where(eq(committeeAccounts.id, user.id))
        .limit(1);

    // Console log for debugging
    console.log('[adminMiddleware]', {
        uid: user.id,
        role: committee?.role ?? 'N/A',
        foundInTable: !!committee,
    });

    if (!committee || !committee.isActive) {
        return c.json({ error: 'Forbidden: Requires active committee access' }, 403);
    }

    await next();
};
```

**What:** The middleware now selects `isActive` from the DB and rejects deactivated committee members with 403. Previously, deactivated users could still access all admin routes.

---

### Fix 4 — N+1 → 3 Queries in `GET /api/admin/teams`

#### [admin.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/admin/admin.route.ts)

**Before:** `Promise.all(teams.map(async (team) => { ...2 queries per team... }))` — 2N+1 queries total.

**After:** 3 fixed queries regardless of team count:
1. Fetch all teams with competition join (`1 query`)
2. Bulk-fetch all transactions via `inArray(teamIds)`, build `Map<teamId, tx>` keeping only the latest per team (`1 query`)
3. Bulk-fetch all team administration records via `inArray(teamIds)`, build `Map<teamId, doc>` (`1 query`)
4. Synchronous `.map()` to merge data from both maps

**Performance:** For 100 teams: **201 → 3 queries** (~67× fewer DB round-trips).

---

### Fix 5 — Remove Duplicate Export Router

#### [admin.route.ts](file:///d:/Coding/localrepositories/wildcat-be/src/modules/admin/admin.route.ts)

```diff
-admin.route('/export', exportRouter);
```

Removed the duplicate registration at line 677. The original at line 19 is kept.

---

## Test Results

```
Test Files  126 passed / 150 total
```

All 24 failures are **pre-existing** in test suites not modified by these changes:
- [payment.test.ts](file:///d:/Coding/localrepositories/wildcat-be/src/tests/payment.test.ts) — "Cannot find package" error (import resolution)
- `assets.service.test.ts` — 1 failing assertion
- `upload`, `submissions`, `transactions` test suites — various pre-existing failures

**No new failures introduced.**

---

## Remaining Items (Not Done)

| Issue | Reason Skipped |
|---|---|
| **Mayar webhook signature verification** | User does not have `MAYAR_WEBHOOK_SECRET` yet |
| **Wildcard CORS origin** | Excluded by user — needs frontend domain(s) |
| **Excessive `console.log`** | Excluded by user |
