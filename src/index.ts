import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import landing from './modules/landing/landing.route.js';
import admin from './modules/admin/admin.route.js';
import upload from './modules/upload/upload.route.js';
import assets from './modules/assets/assets.route.js';
import submissions from './modules/submissions/submission.route.js';
import { authMiddleware } from './middlewares/auth.js';
import type { Env, Variables } from './types/index.js';
import { adminMiddleware } from './middlewares/adminAuth.js';
import { announcementRoutes } from './modules/announcements/announcements.route.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Security Hardening (NF01)
app.use('*', secureHeaders());

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

// 4. Health Check (For Docker/PM2 - BE-15)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 5. Mount Modules
app.route('/api/landing', landing);
app.route('/api/admin', admin);
app.route('/api/announcements', announcementRoutes);
app.route('/api/assets', assets);
app.route('/api/upload', upload);
app.route('/api/submissions', submissions);
app.route('/api/announcements', announcementRoutes);

// 6. Start Server
export default app;