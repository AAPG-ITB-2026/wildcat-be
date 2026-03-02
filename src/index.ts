import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
// import landing from './modules/landing/landing.route';
import teamsRoute from './modules/teams/teams.route.js';
import membersRoute from './modules/members/members.route.js';
import { authMiddleware } from './middlewares/auth.js';
// import admin from './modules/admin/admin.route.js';
import type { Env, Variables } from './types/index.js';
import eventsRoute from './modules/events/events.route.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Security Hardening (NF01)
app.use('*', secureHeaders());
// app.use('/api/landing/*', authMiddleware);
// app.use('/api/admin/*', authMiddleware);

// 2. CORS (NF02 - Privacy & Access)
// TODO: adjust whitelisting and credentials: true
app.use('*', cors({
  origin: '*', // Frontend URL 
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));

// 3. Health Check (For Docker/PM2 - BE-15)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 4. Mount Modules
// app.route('/api/landing', landing);
app.route('/api/teams', teamsRoute);
app.route('/api/members', membersRoute);
app.route('/api/events', eventsRoute);
// TODO: add trailing slash middleware?
// app.route('/api/admin', admin);

export default app;
