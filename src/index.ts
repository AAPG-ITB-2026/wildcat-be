import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import landing from './modules/landing/landing.route';
import { authMiddleware } from './middlewares/auth';

const app = new Hono();

// 1. Security Hardening (NF01)
app.use('*', secureHeaders());
app.use('/api/landing/*', authMiddleware);

// 2. CORS (NF02 - Privacy & Access)
app.use('*', cors({
  origin: '*', // Frontend URL
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// 3. Health Check (For Docker/PM2 - BE-15)
app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

// 4. Mount Modules
app.route('/api/landing', landing);

// 5. Start Server
const port = Number(process.env.PORT) || 3000;
console.log(`Wildcat Backend running on port ${port}`);

serve({
  fetch: app.fetch,
  port
});