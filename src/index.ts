import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import landing from './modules/landing/landing.route.js';
import admin from './modules/admin/admin.route.js';
import payment from './modules/payment/payment.route.js';
import { authMiddleware } from './middlewares/auth.js';
import type { Env, Variables } from './types/index.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Security Hardening (NF01)
app.use('*', secureHeaders());
app.use('/api/landing/*', authMiddleware);
app.use('/api/admin/*', authMiddleware);
app.use('/api/payment/token', authMiddleware);
app.use('/api/payment/status', authMiddleware);

// 2. CORS (NF02 - Privacy & Access)
app.use('*', cors({
  origin: '*', // Frontend URL
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// 3. Health Check (For Docker/PM2 - BE-15)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 4. Mount Modules
app.route('/api/landing', landing);
app.route('/api/admin', admin);
app.route('/api/payment', payment);

// 5. Start Server
export default app;