import { Hono } from 'hono';
import { desc, eq, or } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { announcements, teamAccounts, competitions } from '../../db/schema.js';
import { authMiddleware } from '../../middlewares/auth.js';
import type { Env, Variables } from '../../types/index.js';

export const announcementRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

announcementRoutes.use('/*', authMiddleware);

announcementRoutes.get('/', async (c) => {
    try {
        const user = c.get('user'); // Got from authMiddleware
        const db = createDb(c.env);

        // 1. Find out which competition this team is enrolled in
        const [teamInfo] = await db
            .select({
                competitionName: competitions.name // e.g., "BCC", "GnG"
            })
            .from(teamAccounts)
            .innerJoin(competitions, eq(teamAccounts.competitionId, competitions.id))
            .where(eq(teamAccounts.id, user.id))
            .limit(1);

        if (!teamInfo) {
            return c.json({ error: 'Team profile not found' }, 404);
        }

        // 2. Fetch targeted announcements
        // We look for messages meant for 'All' OR messages meant for this specific team's competition
        const data = await db
            .select({
                id: announcements.id,
                title: announcements.title,
                content: announcements.content,
                targetAudience: announcements.targetAudience,
                attachmentUrl: announcements.attachmentUrl,
                createdAt: announcements.createdAt,
            })
            .from(announcements)
            .where(
                or(
                    eq(announcements.targetAudience, 'All'),
                    eq(announcements.targetAudience, teamInfo.competitionName as any) 
                )
            )
            .orderBy(desc(announcements.createdAt));

        return c.json({ success: true, data }, 200);

    } catch (error) {
        console.error('Failed to fetch announcements:', error);
        return c.json({ success: false, error: 'Internal Server Error' }, 500);
    }
});