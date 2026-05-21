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
import webhooks from './modules/webhooks/webhooks.route.js';
import { authMiddleware } from './middlewares/auth.js';
import type { Env, Variables } from './types/index.js';
import { adminMiddleware } from './middlewares/adminAuth.js';
import { announcementRoutes } from './modules/announcements/announcements.route.js';
import { logger } from './middlewares/logger.js';
import { cleanupExpiredTransactions } from './lib/transaction-cleanup.js';
import type { ScheduledEvent, ExecutionContext, ExportedHandler } from '@cloudflare/workers-types';

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
// Middleware to handle CORS with environment-specific origins
app.use('*', async (c, next) => {
  const frontendUrl = c.env.FRONTEND_URL;
  return cors({
    origin: frontendUrl || 'http://localhost:3000', // Use FRONTEND_URL from env, fallback to localhost
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    credentials: true,
  })(c, next);
});

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
app.route('/api/webhooks', webhooks);

console.log('[app.init] Routes registered:');
console.log('  - /api/landing/*');
console.log('  - /api/admin/*');
console.log('  - /api/announcements/*');
console.log('  - /api/assets/*');
console.log('  - /api/upload/* (POST /sign, POST /confirm, GET /:teamId/:documentType)');
console.log('  - /api/submissions/* (POST /request-url, POST /, GET /:requirementId)');
console.log('  - /api/transactions/* (POST /request-url, POST /submit-proof)');
console.log('  - /api/webhooks/* (POST /events/:id/register)');

// 6. Scheduled Handler for transaction cleanup
const handleScheduled = async (event: ScheduledEvent, env: Env): Promise<void> => {
  try {
    const deletedCount = await cleanupExpiredTransactions(env, 10);
    console.log(`[cron] Transaction cleanup completed. Deleted ${deletedCount} expired transactions.`);
  } catch (error) {
    console.error('[cron] Transaction cleanup failed:', error);
  }
};

// 7. Unified handler that supports both HTTP and Scheduled events
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    return handleScheduled(event, env);
  },
} as any;