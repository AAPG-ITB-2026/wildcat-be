import { Hono } from 'hono';
import { z } from 'zod';
import { eq, sql, desc } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { appConfig, appContent, announcements, teamAdministration, teamAccounts, competitions, events, eventRegistrationLogs, committeeAccounts, transactions } from '../../db/schema.js';
import { committeeMiddleware } from '../../middlewares/auth.js';
import { getStorage } from '../../lib/r2.js';
import { listAllSubmissions } from '../submissions/submission.service.js';
import { createDrizzleGatekeepingRepo } from '../submissions/adapters/drizzle-gatekeeping.adapter.js';
import { createDrizzleSubmissionRepo } from '../submissions/adapters/drizzle-submission.adapter.js';
import { createDrizzleSubmissionTeamRepo } from '../submissions/adapters/drizzle-submission-team.adapter.js';
import exportRouter from './export.route.js';
import { logInfo, logError } from '../../middlewares/logger.js';
import type { Env, Variables } from '../../types/index.js';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/me
// Returns current committee member's info (role, division, etc.)
// Security: Requires active committee member
// ─────────────────────────────────────────────────────────────────────────────
admin.get('/me', committeeMiddleware(), async (c) => {
  const committee = c.get('committee');

  return c.json({
    success: true,
    committee: {
      id: committee.id,
      name: committee.name,
      role: committee.role, // "Admin" | "Committee" (treated as same)
      division: committee.division,
      isActive: committee.isActive,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/committee
// Fetch all committee members
// Security: Admin or Committee role
//
// Description:
//   Retrieves a list of all committee members in the system with their
//   roles, divisions, and active status.
//
// Response:
//   {
//     "success": true,
//     "data": {
//       "total": 10,
//       "members": [
//         {
//           "id": "uuid",
//           "name": "John Doe",
//           "role": "Admin",
//           "division": "Technical",
//           "isActive": true
//         }
//       ]
//     }
//   }
//
// Query Params: None
// Body: None
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/committee',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    logInfo('admin.committee', 'Fetching all committee members');

    try {
      const db = createDb(c.env);

      const committeeMembers = await db
        .select({
          id: committeeAccounts.id,
          name: committeeAccounts.name,
          role: committeeAccounts.role,
          division: committeeAccounts.division,
          isActive: committeeAccounts.isActive,
        })
        .from(committeeAccounts);

      const duration = Date.now() - startTime;
      logInfo(
        'admin.committee',
        `Successfully fetched ${committeeMembers.length} committee members (${duration}ms)`,
      );

      return c.json({
        success: true,
        data: {
          total: committeeMembers.length,
          members: committeeMembers,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.committee',
        `Error fetching committee members (${duration}ms):`,
        error,
      );
      return c.json(
        { error: 'Failed to fetch committee members', details: String(error) },
        500,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/committee
// Create or update a committee member (upsert)
// Security: Admin role ONLY
//
// Description:
//   Creates a new committee member or updates an existing one. If a member with
//   the provided ID already exists, their details will be updated. Otherwise,
//   a new committee member is created.
//
// Body:
//   {
//     "id": "uuid",
//     "name": "John Doe",
//     "role": "Admin" | "Committee",
//     "division": "Technical",
//     "isActive": true
//   }
//
// Response:
//   {
//     "success": true,
//     "message": "Committee member created successfully",
//     "member": {
//       "id": "uuid",
//       "name": "John Doe",
//       "role": "Admin",
//       "division": "Technical",
//       "isActive": true
//     }
//   }
//
// Error Responses:
//   - 400: Invalid body
//   - 500: Database error
// ─────────────────────────────────────────────────────────────────────────────
const createCommitteeMemberSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  name: z.string().min(1, 'name cannot be empty'),
  role: z.enum(['Admin', 'Committee']),
  division: z.string().min(1, 'division cannot be empty'),
  isActive: z.boolean().default(true),
});

admin.post(
  '/committee',
  committeeMiddleware({ roles: ['Admin'] }),
  async (c) => {
    const startTime = Date.now();
    const body = await c.req.json();
    const parsed = createCommitteeMemberSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        400,
      );
    }

    const { id, name, role, division, isActive } = parsed.data;
    const currentAdmin = c.get('committee');
    const db = createDb(c.env);

    logInfo('admin.committee.upsert', `Upserting committee member ${id}`);

    try {
      // Upsert: insert or update in one operation
      const [result] = await db
        .insert(committeeAccounts)
        .values({
          id,
          name,
          role,
          division,
          isActive,
        })
        .onConflictDoUpdate({
          target: committeeAccounts.id,
          set: {
            name,
            role,
            division,
            isActive,
          },
        })
        .returning({
          id: committeeAccounts.id,
          name: committeeAccounts.name,
          role: committeeAccounts.role,
          division: committeeAccounts.division,
          isActive: committeeAccounts.isActive,
        });

      const duration = Date.now() - startTime;
      logInfo(
        'admin.committee.upsert',
        `Successfully upserted committee member ${id} (by ${currentAdmin.id}) in ${duration}ms`,
      );

      return c.json(
        {
          success: true,
          message: 'Committee member created successfully',
          member: result,
        },
        200,
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.committee.upsert',
        `Error upserting committee member ${id} (${duration}ms):`,
        error,
      );
      return c.json(
        { error: 'Failed to create committee member', details: String(error) },
        500,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/committee/:memberId/role
// Update a committee member's role
// Security: Admin role ONLY
//
// Description:
//   Updates a committee member's role (Admin or Committee). Only admins can
//   modify committee member roles.
//
// Body:
//   {
//     "role": "Admin" | "Committee"
//   }
//
// Response:
//   {
//     "success": true,
//     "message": "Committee member role updated successfully",
//     "member": {
//       "id": "uuid",
//       "name": "John Doe",
//       "role": "Admin",
//       "division": "Technical",
//       "isActive": true
//     }
//   }
//
// Path Params: memberId (UUID)
// ─────────────────────────────────────────────────────────────────────────────
const updateRoleSchema = z.object({
  role: z.enum(['Admin', 'Committee']),
});

admin.patch(
  '/committee/:memberId/role',
  committeeMiddleware({ roles: ['Admin'] }),
  async (c) => {
    const startTime = Date.now();
    const memberId = c.req.param('memberId');

    logInfo('admin.committee.updateRole', `Updating role for committee member ${memberId}`);

    try {
      const body = await c.req.json();
      const parsed = updateRoleSchema.safeParse(body);

      if (!parsed.success) {
        logError(
          'admin.committee.updateRole',
          `Invalid body for member ${memberId}:`,
          parsed.error.flatten(),
        );
        return c.json(
          {
            error: 'Invalid body',
            details: parsed.error.flatten(),
          },
          400,
        );
      }

      const { role } = parsed.data;
      const db = createDb(c.env);
      const currentAdmin = c.get('committee');

      // Verify committee member exists
      const [memberExists] = await db
        .select({ id: committeeAccounts.id, name: committeeAccounts.name })
        .from(committeeAccounts)
        .where(eq(committeeAccounts.id, memberId))
        .limit(1);

      if (!memberExists) {
        logError('admin.committee.updateRole', `Committee member not found: ${memberId}`);
        return c.json({ error: 'Committee member not found' }, 404);
      }

      // Update the role
      const [updated] = await db
        .update(committeeAccounts)
        .set({ role })
        .where(eq(committeeAccounts.id, memberId))
        .returning({
          id: committeeAccounts.id,
          name: committeeAccounts.name,
          role: committeeAccounts.role,
          division: committeeAccounts.division,
          isActive: committeeAccounts.isActive,
        });

      const duration = Date.now() - startTime;
      logInfo(
        'admin.committee.updateRole',
        `Successfully updated role for committee member ${memberId} to ${role} (by ${currentAdmin.id}) in ${duration}ms`,
      );

      return c.json(
        {
          success: true,
          message: 'Committee member role updated successfully',
          member: updated,
        },
        200,
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.committee.updateRole',
        `Error updating committee member role (${duration}ms):`,
        error,
      );
      return c.json(
        { error: 'Failed to update committee member role', details: String(error) },
        500,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/committee/:memberId
// Delete a committee member
// Security: Admin role ONLY
//
// Description:
//   Permanently removes a committee member from the system. This action cannot
//   be undone. Only admins can delete committee members.
//
// Response:
//   {
//     "success": true,
//     "message": "Committee member deleted successfully",
//     "memberId": "uuid"
//   }
//
// Path Params: memberId (UUID)
//
// Error Responses:
//   - 404: Committee member not found
//   - 500: Database error
// ─────────────────────────────────────────────────────────────────────────────
admin.delete(
  '/committee/:memberId',
  committeeMiddleware({ roles: ['Admin'] }),
  async (c) => {
    const startTime = Date.now();
    const memberId = c.req.param('memberId');

    logInfo('admin.committee.delete', `Deleting committee member ${memberId}`);

    try {
      const db = createDb(c.env);
      const currentAdmin = c.get('committee');

      // Verify committee member exists before deleting
      const [memberExists] = await db
        .select({ id: committeeAccounts.id, name: committeeAccounts.name })
        .from(committeeAccounts)
        .where(eq(committeeAccounts.id, memberId))
        .limit(1);

      if (!memberExists) {
        logError('admin.committee.delete', `Committee member not found: ${memberId}`);
        return c.json({ error: 'Committee member not found' }, 404);
      }

      // Delete the committee member
      await db.delete(committeeAccounts).where(eq(committeeAccounts.id, memberId));

      const duration = Date.now() - startTime;
      logInfo(
        'admin.committee.delete',
        `Successfully deleted committee member ${memberId} (by ${currentAdmin.id}) in ${duration}ms`,
      );

      return c.json(
        {
          success: true,
          message: 'Committee member deleted successfully',
          memberId,
        },
        200,
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.committee.delete',
        `Error deleting committee member (${duration}ms):`,
        error,
      );
      return c.json(
        { error: 'Failed to delete committee member', details: String(error) },
        500,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/teams
// Fetch all team accounts with payment and document verification status
// Security: Admin or Committee role
//
// Description:
//   Retrieves a list of all team accounts in the system with their
//   details including team name, institution, members, competition info,
//   payment status, and document verification status.
//
// Response:
//   {
//     "success": true,
//     "data": {
//       "total": 25,
//       "teams": [
//         {
//           "id": "uuid",
//           "teamName": "Team A",
//           "institution": "University XYZ",
//           "phoneNumber": "+62812345678",
//           "lineId": "@teamid",
//           "leadName": "John Doe",
//           "leadMajor": "Computer Science",
//           "m1Name": "Jane Smith",
//           "m1Major": "Engineering",
//           "m2Name": "Bob Johnson",
//           "m2Major": "Geology",
//           "competitionId": "uuid",
//           "competitionName": "Business Case Competition",
//           "currentStageId": "uuid",
//           "createdAt": "2024-01-15T10:30:00Z",
//           "status": {
//             "paymentStatus": "Verified" | "Pending" | "Rejected" | "None",
//             "documentVerificationStatus": "Verified" | "Pending" | "Rejected",
//             "paymentAmount": "50000.00",
//             "paymentVerifiedAt": "2024-01-16T10:30:00Z",
//             "documentVerifiedAt": "2024-01-17T10:30:00Z"
//           }
//         }
//       ]
//     }
//   }
//
// Query Params: None
// Body: None
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/teams',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    logInfo('admin.teams', 'Fetching all team accounts with status');

    try {
      const db = createDb(c.env);

      // Fetch all teams with their competition info
      const teams = await db
        .select({
          id: teamAccounts.id,
          teamName: teamAccounts.teamName,
          institution: teamAccounts.institution,
          phoneNumber: teamAccounts.phoneNumber,
          lineId: teamAccounts.lineId,
          leadName: teamAccounts.leadName,
          leadMajor: teamAccounts.leadMajor,
          m1Name: teamAccounts.m1Name,
          m1Major: teamAccounts.m1Major,
          m2Name: teamAccounts.m2Name,
          m2Major: teamAccounts.m2Major,
          competitionId: teamAccounts.competitionId,
          competitionName: competitions.name,
          currentStageId: teamAccounts.currentStageId,
          createdAt: teamAccounts.createdAt,
        })
        .from(teamAccounts)
        .innerJoin(competitions, eq(teamAccounts.competitionId, competitions.id));

      // For each team, fetch their payment and document verification status
      const teamsWithStatus = await Promise.all(
        teams.map(async (team) => {
          // Get latest transaction for this team
          const [latestTransaction] = await db
            .select({
              verificationStatus: transactions.verificationStatus,
              amount: transactions.amount,
              createdAt: transactions.createdAt,
            })
            .from(transactions)
            .where(eq(transactions.teamId, team.id))
            .orderBy(desc(transactions.createdAt))
            .limit(1);

          // Get document verification status
          const [docVerification] = await db
            .select({
              verificationStatus: teamAdministration.verificationStatus,
            })
            .from(teamAdministration)
            .where(eq(teamAdministration.teamId, team.id))
            .limit(1);

          const paymentStatus = latestTransaction?.verificationStatus ?? 'None';
          const documentVerificationStatus = docVerification?.verificationStatus ?? 'Pending';

          return {
            ...team,
            status: {
              paymentStatus,
              documentVerificationStatus,
              paymentAmount: latestTransaction?.amount ?? null,
              paymentVerifiedAt: latestTransaction?.createdAt ?? null,
            },
          };
        }),
      );

      const duration = Date.now() - startTime;
      logInfo(
        'admin.teams',
        `Successfully fetched ${teamsWithStatus.length} team accounts with status (${duration}ms)`,
      );

      return c.json({
        success: true,
        data: {
          total: teamsWithStatus.length,
          teams: teamsWithStatus,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.teams',
        `Error fetching team accounts (${duration}ms):`,
        error,
      );
      return c.json(
        { error: 'Failed to fetch team accounts', details: String(error) },
        500,
      );
    }
  },
);

admin.route('/export', exportRouter);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/config
// Toggle global flags: RELEASE_SCORES or MAINTENANCE_MODE
// Body: { key: "RELEASE_SCORES" | "MAINTENANCE_MODE", value: "true" | "false" }
// ─────────────────────────────────────────────────────────────────────────────
const configSchema = z.object({
  key: z.enum(['RELEASE_SCORES', 'MAINTENANCE_MODE']),
  value: z.enum(['true', 'false']),
});

admin.patch('/config', async (c) => {
  const body = await c.req.json();
  const parsed = configSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
  }

  const { key, value } = parsed.data;
  const db = createDb(c.env);

  await db
    .insert(appConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    });

  return c.json({ success: true, key, value });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/content/:section
// Update static CMS content (FAQs, Judges, Hero, etc.) stored in DB
// Body: { content: string }  — pass JSON.stringify(yourData) as the value
// ─────────────────────────────────────────────────────────────────────────────
const contentSchema = z.object({
  content: z.string().min(1, 'content cannot be empty'),
});

admin.put('/content/:section', async (c) => {
  const section = c.req.param('section');
  const body = await c.req.json();
  const parsed = contentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
  }

  const { content } = parsed.data;
  const db = createDb(c.env);

  await db
    .insert(appContent)
    .values({ section, content, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appContent.section,
      set: { content, updatedAt: new Date() },
    });

  return c.json({ success: true, section, updatedAt: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/announcements/:announcementId
// Upsert (create or update) a broadcast announcement
// Body: { title: string, content: string, targetAudience: string, attachmentUrl?: string, scheduledFor?: string }
// Security: Admin or Committee role
//
// Description:
//   Create a new announcement or update an existing one. If the announcement with
//   the provided ID exists, it will be updated. Otherwise, a new one is created.
// ─────────────────────────────────────────────────────────────────────────────
const announcementSchema = z.object({
  title: z.string().min(1, 'title cannot be empty'),
  content: z.string().min(1, 'content cannot be empty'),
  targetAudience: z.enum(['All', 'Paper_Poster', 'BCC', 'GnG', 'HighSchool']),
  attachmentUrl: z.string().url().optional(),
  scheduledFor: z.string().datetime().optional(),
});

const audienceMap: Record<string, string> = {
  'All': 'All',
  'Paper_Poster': 'Paper and Poster Case Competition',
  'BCC': 'Business Case Competition',
  'GnG': 'Geology and Geophysics Case Study Competition (GnG)',
  'HighSchool': 'Highschool Essay Competition',
};

admin.put(
  '/announcements/:announcementId',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    const announcementId = c.req.param('announcementId');
    const body = await c.req.json();
    const parsed = announcementSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }

    const { title, content, targetAudience, attachmentUrl, scheduledFor } = parsed.data;
    const user = c.get('user');
    const db = createDb(c.env);

    logInfo('admin.announcements.upsert', `Upserting announcement ${announcementId}`);

    try {
      const mappedAudience = audienceMap[targetAudience] as typeof announcements.$inferInsert['targetAudience'];
      
      // Upsert: insert or update in one operation
      const [result] = await db
        .insert(announcements)
        .values({
          id: announcementId,
          authorId: user.id,
          title,
          content,
          targetAudience: mappedAudience,
          attachmentUrl: attachmentUrl ?? null,
          scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
        })
        .onConflictDoUpdate({
          target: announcements.id,
          set: {
            title,
            content,
            targetAudience: mappedAudience,
            attachmentUrl: attachmentUrl ?? null,
            scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
          },
        })
        .returning();

      const duration = Date.now() - startTime;
      logInfo(
        'admin.announcements.upsert',
        `Successfully upserted announcement ${announcementId} (${duration}ms)`,
      );

      return c.json({ success: true, announcement: result }, 200);
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.announcements.upsert',
        `Error upserting announcement ${announcementId} (${duration}ms):`,
        error,
      );
      return c.json(
        { error: 'Failed to upsert announcement', details: String(error) },
        500,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/announcements/:announcementId
// Delete a broadcast announcement
// Security: Admin or Committee role
//
// Description:
//   Permanently delete an announcement from the system.
//
// Path Params:
//   - announcementId (UUID): The announcement ID
//
// Response:
//   {
//     "success": true,
//     "message": "Announcement deleted successfully"
//   }
//
// Error Responses:
//   - 404: Announcement not found
//   - 500: Database error
// ─────────────────────────────────────────────────────────────────────────────
admin.delete(
  '/announcements/:announcementId',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    const announcementId = c.req.param('announcementId');

    logInfo('admin.announcements.delete', `Deleting announcement ${announcementId}`);

    try {
      const db = createDb(c.env);

      // Check if announcement exists before deleting
      const [existing] = await db
        .select({ id: announcements.id })
        .from(announcements)
        .where(eq(announcements.id, announcementId))
        .limit(1);

      if (!existing) {
        logError('admin.announcements.delete', `Announcement not found: ${announcementId}`);
        return c.json({ error: 'Announcement not found' }, 404);
      }

      // Delete the announcement
      await db.delete(announcements).where(eq(announcements.id, announcementId));

      const duration = Date.now() - startTime;
      logInfo(
        'admin.announcements.delete',
        `Successfully deleted announcement ${announcementId} (${duration}ms)`,
      );

      return c.json({ success: true, message: 'Announcement deleted successfully' }, 200);
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.announcements.delete',
        `Error deleting announcement ${announcementId} (${duration}ms):`,
        error,
      );
      return c.json(
        { error: 'Failed to delete announcement', details: String(error) },
        500,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/verify
// Accept or Reject a team's administration documents
// With automatic document validation:
//   - Checks: leadKtm, m1Ktm, m2Ktm, twibbonProof, posterProof (all required)
//   - If ANY document is missing: ALWAYS auto-rejects, regardless of action param
//   - If ALL documents present: Respects the action (Verified/Rejected)
//   - Manual rejection can include custom rejection notes
//
// Body: { teamId: string, action: "Verified" | "Rejected", rejectionNotes?: string }
// Security: CommitteeAccount middleware (Admin or Committee role)
// Response: returns updated verification status + full team info + document validation
// ─────────────────────────────────────────────────────────────────────────────
const verifySchema = z.object({
  teamId: z.string().uuid('teamId must be a valid UUID'),
  action: z.enum(['Verified', 'Rejected']),
  rejectionNotes: z.string().optional(),
});

/**
 * Calculate document completeness
 * Returns which documents are missing (all docs are required)
 */
function validateDocuments(admin: {
  leadKtm: string | null;
  m1Ktm: string | null;
  m2Ktm: string | null;
  twibbonProof: string | null;
  posterProof: string | null;
}): {
  isComplete: boolean;
  missingDocs: Array<{ name: string; type: string }>;
  submittedDocs: Array<{ name: string; type: string }>;
} {
  const allDocs = [
    { name: 'Lead Student ID Card (KTM)', type: 'leadKtm', value: admin.leadKtm },
    { name: 'Member 1 Student ID Card (KTM)', type: 'm1Ktm', value: admin.m1Ktm },
    { name: 'Member 2 Student ID Card (KTM)', type: 'm2Ktm', value: admin.m2Ktm },
    { name: 'Twibbon Proof', type: 'twibbonProof', value: admin.twibbonProof },
    { name: 'Poster Proof', type: 'posterProof', value: admin.posterProof },
  ];

  const missingDocs = allDocs.filter((doc) => !doc.value).map((doc) => ({ name: doc.name, type: doc.type }));
  const submittedDocs = allDocs.filter((doc) => doc.value).map((doc) => ({ name: doc.name, type: doc.type }));

  return {
    isComplete: missingDocs.length === 0,
    missingDocs,
    submittedDocs,
  };
}

admin.post(
  '/verify',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const body = await c.req.json();
    const parsed = verifySchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }

    const { teamId, action, rejectionNotes: manualRejectionNotes } = parsed.data;

    const committee = c.get('committee');
    const db = createDb(c.env);

    // Fetch team administration with all document fields
    const [existing] = await db
      .select({
        teamId: teamAdministration.teamId,
        leadKtm: teamAdministration.leadKtm,
        m1Ktm: teamAdministration.m1Ktm,
        m2Ktm: teamAdministration.m2Ktm,
        twibbonProof: teamAdministration.twibbonProof,
        posterProof: teamAdministration.posterProof,
      })
      .from(teamAdministration)
      .where(eq(teamAdministration.teamId, teamId))
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Team administration record not found' }, 404);
    }

    // Validate documents
    const docValidation = validateDocuments({
      leadKtm: existing.leadKtm,
      m1Ktm: existing.m1Ktm,
      m2Ktm: existing.m2Ktm,
      twibbonProof: existing.twibbonProof,
      posterProof: existing.posterProof,
    });

    // Determine final action and rejection notes
    let finalAction = action;
    let rejectionNotes: string | null = null;
    let wasAutoRejected = false;

    if (!docValidation.isComplete) {
      // AUTO-REJECT: Always reject if documents are incomplete
      finalAction = 'Rejected';
      wasAutoRejected = true;

      const submittedList = docValidation.submittedDocs.length > 0 
        ? `Submitted documents:\n${docValidation.submittedDocs.map((doc) => `✓ ${doc.name}`).join('\n')}\n\n`
        : '';

      const missingList = docValidation.missingDocs.map((doc) => `✗ ${doc.name}`).join('\n');

      rejectionNotes = `Your document submission is incomplete and has been automatically rejected.\n\n${submittedList}Missing documents:\n${missingList}\n\nPlease upload all required documents and resubmit for verification.`;
    } else if (finalAction === 'Rejected' && manualRejectionNotes) {
      rejectionNotes = manualRejectionNotes;
    }

    // Update verification status
    const [updated] = await db
      .update(teamAdministration)
      .set({
        verificationStatus: finalAction,
        verifiedBy: committee.id,
        rejectionNotes,
      })
      .where(eq(teamAdministration.teamId, teamId))
      .returning();

    // Fetch team details
    const [team] = await db
      .select({
        id: teamAccounts.id,
        teamName: teamAccounts.teamName,
        institution: teamAccounts.institution,
        leadName: teamAccounts.leadName,
        competitionId: teamAccounts.competitionId,
        createdAt: teamAccounts.createdAt,
      })
      .from(teamAccounts)
      .where(eq(teamAccounts.id, teamId))
      .limit(1);

    return c.json({
      success: true,
      verification: {
        teamId: updated.teamId,
        verificationStatus: updated.verificationStatus,
        verifiedBy: updated.verifiedBy,
        rejectionNotes: updated.rejectionNotes,
      },
      documentValidation: {
        isComplete: docValidation.isComplete,
        submittedDocs: docValidation.submittedDocs,
        missingDocs: docValidation.missingDocs,
        wasAutoRejected,
      },
      team,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/documents/teams
// List all teams with their administration documents and verification statuses
// Returns signed download URLs for each document
// Security: Admin or Committee role
//
// Description:
//   Retrieves all teams registered across all competitions along with their
//   administration documents (KTM cards, twibbon proof, poster proof) and their
//   current verification status. For each document that exists, generates a
//   1-hour signed download URL for secure access without exposing R2 credentials.
//
// Response: 
//   {
//     "teams": [
//       {
//         "teamId": "uuid",
//         "teamName": "Team A",
//         "institution": "University XYZ",
//         "competition": "Business Case Competition",
//         "documents": [
//           {
//             "type": "lead_ktm",
//             "url": "signed-r2-download-url",
//             "exists": true
//           },
//           {
//             "type": "m1_ktm",
//             "url": null,
//             "exists": false
//           }
//         ],
//         "verificationStatus": "Pending" | "Verified" | "Rejected",
//         "verifiedBy": "committee-uuid or null",
//         "rejectionNotes": "string or null"
//       }
//     ]
//   }
//
// Use Cases:
//   - Admin dashboard to review all pending document verifications
//   - Bulk download verification (check which teams are missing documents)
//   - Identify teams with rejected documents that need resubmission
//
// Query Params: None
// Body: None
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/documents/teams',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    logInfo('admin.documents.teams', 'Fetching all team administration documents');

    try {
      const db = createDb(c.env);
      const storage = getStorage(c.env);

      // Fetch all team administrations with team details
      logInfo('admin.documents.teams', 'Querying database for team administrations');
      const administrations = await db
        .select({
          teamId: teamAdministration.teamId,
          teamName: teamAccounts.teamName,
          institution: teamAccounts.institution,
          competitionId: teamAccounts.competitionId,
          competitionName: competitions.name,
          leadKtm: teamAdministration.leadKtm,
          m1Ktm: teamAdministration.m1Ktm,
          m2Ktm: teamAdministration.m2Ktm,
          twibbonProof: teamAdministration.twibbonProof,
          posterProof: teamAdministration.posterProof,
          verificationStatus: teamAdministration.verificationStatus,
          verifiedBy: teamAdministration.verifiedBy,
          rejectionNotes: teamAdministration.rejectionNotes,
        })
        .from(teamAdministration)
        .innerJoin(teamAccounts, eq(teamAdministration.teamId, teamAccounts.id))
        .innerJoin(competitions, eq(teamAccounts.competitionId, competitions.id));

      logInfo(
        'admin.documents.teams',
        `Found ${administrations.length} teams to process`,
      );

      // Transform to include signed URLs and document metadata
      const teams = await Promise.all(
        administrations.map(async (admin) => {
          // Helper to create signed URL if document exists
          const getDocumentUrl = async (filePath: string | null, docType: string): Promise<{ type: string; url: string | null; exists: boolean } | null> => {
            // Skip if no file path
            if (!filePath) {
              return null;
            }

            try {
              // Strip bucket name for R2 API
              const pathWithoutBucket = filePath.startsWith('wildcat2026/')
                ? filePath.substring('wildcat2026/'.length)
                : filePath;

              const { data: signedUrl, error: urlError } = await storage.createSignedDownloadUrl(
                pathWithoutBucket,
                3600,
              );
              
              if (urlError || !signedUrl) {
                logInfo(
                  'admin.documents.teams',
                  `Could not create signed URL for ${docType} - team ${admin.teamId}`,
                );
                return null;
              }
              
              return {
                type: docType,
                url: signedUrl,
                exists: true,
              };
            } catch (error) {
              logInfo(
                'admin.documents.teams',
                `Skipped ${docType} for team ${admin.teamId}`,
              );
              return null;
            }
          };

          // Build documents array in parallel and filter out nulls
          const docResults = await Promise.all([
            getDocumentUrl(admin.leadKtm, 'lead_ktm'),
            getDocumentUrl(admin.m1Ktm, 'm1_ktm'),
            getDocumentUrl(admin.m2Ktm, 'm2_ktm'),
            getDocumentUrl(admin.twibbonProof, 'twibbon_proof'),
            getDocumentUrl(admin.posterProof, 'poster_proof'),
          ]);

          const documents = docResults.filter((doc): doc is { type: string; url: string; exists: boolean } => doc !== null);

          return {
            teamId: admin.teamId,
            teamName: admin.teamName,
            institution: admin.institution,
            competition: admin.competitionName,
            documents,
            verificationStatus: admin.verificationStatus,
            verifiedBy: admin.verifiedBy,
            rejectionNotes: admin.rejectionNotes,
          };
        }),
      );

      const duration = Date.now() - startTime;
      logInfo(
        'admin.documents.teams',
        `Successfully fetched ${teams.length} teams in ${duration}ms`,
      );

      return c.json({ teams });
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.documents.teams',
        `Error fetching team documents (${duration}ms):`,
        error,
      );
      return c.json(
        { error: 'Failed to fetch team documents', details: String(error) },
        500,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/events/:eventId/attendance
// Update attended count for an event
// Body: { attendedCount: number }
// Security: Admin role ONLY (not Committee)
//
// Description:
//   Updates the attended participant count for a specific event. This is used
//   to track how many people actually attended after registration.
//
// Response:
//   {
//     "success": true,
//     "event": {
//       "id": "uuid",
//       "name": "Workshop Name",
//       "registeredCount": 50,
//       "attendedCount": 45
//     }
//   }
//
// Query Params: None
// Path Params: eventId (UUID)
// ─────────────────────────────────────────────────────────────────────────────
const attendanceSchema = z.object({
  attendedCount: z.number().int().min(0, 'attendedCount must be a non-negative integer'),
});

admin.patch(
  '/events/:eventId/attendance',
  committeeMiddleware({ roles: ['Admin'] }),
  async (c) => {
    const startTime = Date.now();
    const eventId = c.req.param('eventId');

    logInfo('admin.events.attendance', `Updating attendance for event ${eventId}`);

    try {
      const body = await c.req.json();
      const parsed = attendanceSchema.safeParse(body);

      if (!parsed.success) {
        logError(
          'admin.events.attendance',
          `Invalid body for event ${eventId}:`,
          parsed.error.flatten(),
        );
        return c.json(
          {
            error: 'Invalid body',
            details: parsed.error.flatten(),
          },
          400,
        );
      }

      const { attendedCount } = parsed.data;
      const db = createDb(c.env);
      const committee = c.get('committee');

      // Verify event exists
      const [eventExists] = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1);

      if (!eventExists) {
        logError('admin.events.attendance', `Event not found: ${eventId}`);
        return c.json({ error: 'Event not found' }, 404);
      }

      // Update attended count
      const [updated] = await db
        .update(events)
        .set({ attendedCount })
        .where(eq(events.id, eventId))
        .returning({
          id: events.id,
          name: events.name,
          registeredCount: events.registeredCount,
          attendedCount: events.attendedCount,
        });

      const duration = Date.now() - startTime;
      logInfo(
        'admin.events.attendance',
        `Successfully updated attendance for event ${eventId} - attended: ${attendedCount} (by ${committee.id}) in ${duration}ms`,
      );

      return c.json({
        success: true,
        message: `Event attendance updated successfully`,
        event: updated,
      }, 200);
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.events.attendance',
        `Error updating event attendance (${duration}ms):`,
        error,
      );
      return c.json(
        { error: 'Failed to update event attendance', details: String(error) },
        500,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/metrics/events
// Per-event registered & attended counts + grand totals
// Security: Admin role OR Event division
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/metrics/events',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const db = createDb(c.env);

    const rows = await db
      .select({
        id: events.id,
        name: events.name,
        registeredCount: events.registeredCount,
        attendedCount: events.attendedCount,
      })
      .from(events);

    const grandTotalRegistered = rows.reduce((acc, r) => acc + r.registeredCount, 0);
    const grandTotalAttended = rows.reduce((acc, r) => acc + r.attendedCount, 0);

    return c.json({
      events: rows,
      grandTotals: {
        registeredCount: grandTotalRegistered,
        attendedCount: grandTotalAttended,
      },
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/metrics/competitions
// Team count per competition (via COUNT + GROUP BY) + grand total
// Security: Admin or Committee role
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/metrics/competitions',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const db = createDb(c.env);

    const rows = await db
      .select({
        competitionId: competitions.id,
        competitionName: competitions.name,
        teamCount: sql<number>`cast(count(${teamAccounts.id}) as integer)`,
      })
      .from(teamAccounts)
      .rightJoin(competitions, eq(teamAccounts.competitionId, competitions.id))
      .groupBy(competitions.id, competitions.name);

    const grandTotal = rows.reduce((acc, r) => acc + (r.teamCount ?? 0), 0);

    return c.json({
      competitions: rows,
      grandTotal,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/registration-curves
// Competition & Event registration growth curves with daily and cumulative totals
// Security: Admin or Committee role
//
// Description:
//   Retrieves time-series registration data showing both competition team signups
//   and side-event registrations. Returns daily counts and cumulative running totals
//   for each date to visualize marketing growth curves and signup trends.
//
// Response Example:
//   {
//     "registrationCurves": [
//       {
//         "date": "2024-01-15",
//         "competitionSignups": 5,
//         "eventSignups": 12,
//         "totalSignups": 17,
//         "cumulativeCompetitionSignups": 45,
//         "cumulativeEventSignups": 89,
//         "cumulativeTotalSignups": 134
//       }
//     ],
//     "summary": {
//       "totalCompetitionSignups": 150,
//       "totalEventSignups": 280,
//       "totalSignups": 430
//     }
//   }
//
// Query Params: None
// Body: None
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/analytics/registration-curves',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const db = createDb(c.env);

    // Get competition signups grouped by date
    const competitionSignups = await db
      .select({
        date: sql<string>`DATE(${teamAccounts.createdAt})`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(teamAccounts)
      .groupBy(sql`DATE(${teamAccounts.createdAt})`)
      .orderBy(sql`DATE(${teamAccounts.createdAt})`);

    // Get event registration signups grouped by date
    const eventSignups = await db
      .select({
        date: sql<string>`DATE(${eventRegistrationLogs.createdAt})`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(eventRegistrationLogs)
      .groupBy(sql`DATE(${eventRegistrationLogs.createdAt})`)
      .orderBy(sql`DATE(${eventRegistrationLogs.createdAt})`);

    // Merge data by date and calculate cumulative totals
    const dateMap = new Map<string, { competition: number; events: number }>();

    competitionSignups.forEach((row) => {
      if (!dateMap.has(row.date)) {
        dateMap.set(row.date, { competition: 0, events: 0 });
      }
      dateMap.get(row.date)!.competition = row.count;
    });

    eventSignups.forEach((row) => {
      if (!dateMap.has(row.date)) {
        dateMap.set(row.date, { competition: 0, events: 0 });
      }
      dateMap.get(row.date)!.events = row.count;
    });

    // Sort dates and calculate cumulative totals
    const sortedDates = Array.from(dateMap.keys()).sort();
    let cumulativeCompetition = 0;
    let cumulativeEvents = 0;

    const registrationCurves = sortedDates.map((date) => {
      const dailyData = dateMap.get(date)!;
      cumulativeCompetition += dailyData.competition;
      cumulativeEvents += dailyData.events;

      return {
        date,
        competitionSignups: dailyData.competition,
        eventSignups: dailyData.events,
        totalSignups: dailyData.competition + dailyData.events,
        cumulativeCompetitionSignups: cumulativeCompetition,
        cumulativeEventSignups: cumulativeEvents,
        cumulativeTotalSignups: cumulativeCompetition + cumulativeEvents,
      };
    });

    // Calculate summary totals
    const totalCompetitionSignups = competitionSignups.reduce((acc, row) => acc + row.count, 0);
    const totalEventSignups = eventSignups.reduce((acc, row) => acc + row.count, 0);

    return c.json({
      registrationCurves,
      summary: {
        totalCompetitionSignups,
        totalEventSignups,
        totalSignups: totalCompetitionSignups + totalEventSignups,
      },
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/submissions/:teamId
// Get all submissions for a specific team
// Security: Admin or Committee role
//
// Description:
//   Retrieves all submissions for a team across all requirements in their
//   current competition stage. Returns detailed information about submission
//   status, validation, and document metadata. Use this endpoint to review
//   team submission progress and compliance.
//
// Response:
//   {
//     "success": true,
//     "data": {
//       "submissions": [
//         {
//           "requirementId": "uuid",
//           "documentName": "Case Study Report",
//           "submitted": true,
//           "isValid": true,
//           "submittedAt": "2024-01-15T10:30:00Z",
//           "fileUrl": "wildcat2026/submissions/..."
//         }
//       ],
//       "totalRequirements": 3,
//       "submittedCount": 2,
//       "completionPercentage": 67
//     }
//   }
//
// Path Params: teamId (UUID)
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/submissions/:teamId',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    const teamId = c.req.param('teamId');

    logInfo('admin.submissions', `Fetching submissions for team ${teamId}`);

    try {
      const db = createDb(c.env);
      const storage = getStorage(c.env);

      const deps = {
        storage,
        gatekeeping: createDrizzleGatekeepingRepo(db),
        submissions: createDrizzleSubmissionRepo(db),
        teams: createDrizzleSubmissionTeamRepo(db),
      };

      const result = await listAllSubmissions(teamId, deps);

      const duration = Date.now() - startTime;
      logInfo(
        'admin.submissions',
        `Successfully fetched submissions for team ${teamId} - ${result.submittedCount}/${result.totalRequirements} submitted (${duration}ms)`,
      );

      return c.json({ success: true, data: result });
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.submissions',
        `Error fetching submissions for team ${teamId} (${duration}ms):`,
        error,
      );

      // Handle specific errors
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('TEAM_NOT_FOUND')) {
        return c.json({ error: 'Team not found' }, 404);
      }
      if (errorMsg.includes('STAGE_NOT_ASSIGNED')) {
        return c.json({ error: 'Team has not been assigned to a competition stage' }, 400);
      }

      return c.json(
        { error: 'Failed to fetch team submissions', details: String(error) },
        500,
      );
    }
  },
);

admin.get(
  '/submissions',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    logInfo('admin.submissions.all', 'Fetching all teams submissions grouped by competition');

    try {
      const db = createDb(c.env);
      const storage = getStorage(c.env);

      // Fetch all teams with their competition and stage information
      const allTeams = await db
        .select({
          teamId: teamAccounts.id,
          teamName: teamAccounts.teamName,
          institution: teamAccounts.institution,
          competitionId: teamAccounts.competitionId,
          competitionName: competitions.name,
          currentStageId: teamAccounts.currentStageId,
        })
        .from(teamAccounts)
        .innerJoin(competitions, eq(teamAccounts.competitionId, competitions.id));

      logInfo(
        'admin.submissions.all',
        `Found ${allTeams.length} teams across competitions`,
      );

      const deps = {
        storage,
        gatekeeping: createDrizzleGatekeepingRepo(db),
        submissions: createDrizzleSubmissionRepo(db),
        teams: createDrizzleSubmissionTeamRepo(db),
      };

      // Group teams by competition
      const competitionMap = new Map<
        string,
        {
          competitionId: string;
          competitionName: string;
          teams: typeof allTeams;
        }
      >();

      for (const team of allTeams) {
        const key = team.competitionId;
        if (!competitionMap.has(key)) {
          competitionMap.set(key, {
            competitionId: team.competitionId,
            competitionName: team.competitionName,
            teams: [],
          });
        }
        competitionMap.get(key)!.teams.push(team);
      }

      // Fetch submissions for all teams in parallel
      const result = await Promise.all(
        Array.from(competitionMap.values()).map(async (competition) => {
          const teamsWithSubmissions = await Promise.all(
            competition.teams.map(async (team) => {
              try {
                const submissions = await listAllSubmissions(team.teamId, deps);
                return {
                  teamId: team.teamId,
                  teamName: team.teamName,
                  institution: team.institution,
                  ...submissions,
                };
              } catch (error) {
                // Skip teams with errors (e.g., no stage assigned)
                logInfo(
                  'admin.submissions.all',
                  `Skipped team ${team.teamId}: ${error instanceof Error ? error.message : String(error)}`,
                );
                return null;
              }
            }),
          );

          return {
            competitionId: competition.competitionId,
            competitionName: competition.competitionName,
            totalTeams: teamsWithSubmissions.filter((t) => t !== null).length,
            teams: teamsWithSubmissions.filter(
              (t): t is NonNullable<typeof teamsWithSubmissions[0]> => t !== null,
            ),
          };
        }),
      );

      const duration = Date.now() - startTime;
      logInfo(
        'admin.submissions.all',
        `Successfully fetched submissions for all ${allTeams.length} teams (${duration}ms)`,
      );

      return c.json({ success: true, data: result });
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.submissions.all',
        `Error fetching all submissions (${duration}ms):`,
        error,
      );

      return c.json(
        { error: 'Failed to fetch all submissions', details: String(error) },
        500,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/announcements
// Get all announcements grouped by category (targetAudience)
// Security: Admin or Committee role
//
// Description:
//   Retrieves all announcements in the system organized by target audience category.
//   Allows admins to review all broadcast messages sent to different competitions and groups.
//
// Response:
//   {
//     "success": true,
//     "data": [
//       {
//         "category": "All",
//         "count": 5,
//         "announcements": [
//           {
//             "id": "uuid",
//             "title": "Announcement Title",
//             "content": "Announcement content",
//             "targetAudience": "All",
//             "attachmentUrl": "url or null",
//             "createdAt": "2024-01-15T10:30:00Z"
//           }
//         ]
//       },
//       {
//         "category": "Business Case Competition",
//         "count": 3,
//         "announcements": [...]
//       }
//     ]
//   }
//
// Query Params: None
// Body: None
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/announcements',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    logInfo('admin.announcements', 'Fetching all announcements grouped by category');

    try {
      const db = createDb(c.env);

      // Fetch all announcements, ordered by category then by creation date (newest first)
      const allAnnouncements = await db
        .select({
          id: announcements.id,
          title: announcements.title,
          content: announcements.content,
          targetAudience: announcements.targetAudience,
          attachmentUrl: announcements.attachmentUrl,
          createdAt: announcements.createdAt,
        })
        .from(announcements)
        .orderBy(announcements.targetAudience, sql`${announcements.createdAt} DESC`);

      // Group announcements by targetAudience (category)
      const categoryMap = new Map<
        string,
        {
          category: string;
          announcements: typeof allAnnouncements;
        }
      >();

      for (const announcement of allAnnouncements) {
        const category = announcement.targetAudience;
        if (!categoryMap.has(category)) {
          categoryMap.set(category, {
            category,
            announcements: [],
          });
        }
        categoryMap.get(category)!.announcements.push(announcement);
      }

      // Convert map to array and add count for each category
      const data = Array.from(categoryMap.values()).map((item) => ({
        category: item.category,
        count: item.announcements.length,
        announcements: item.announcements,
      }));

      const duration = Date.now() - startTime;
      logInfo(
        'admin.announcements',
        `Successfully fetched ${allAnnouncements.length} announcements across ${data.length} categories (${duration}ms)`,
      );

      return c.json({ success: true, data }, 200);
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.announcements',
        `Error fetching all announcements (${duration}ms):`,
        error,
      );
      return c.json({ success: false, error: 'Internal Server Error' }, 500);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/submissions/:teamId/:requirementId
// Get a signed download URL for a specific team's submission file
// Security: Admin or Committee role
//
// Description:
//   Retrieves a signed download URL for a specific submission file submitted by a team.
//   The URL is valid for 1 hour and allows admins to download and review submissions
//   without exposing R2 credentials.
//
// Response:
//   {
//     "success": true,
//     "data": {
//       "signedUrl": "https://..."
//     }
//   }
//
// Path Params:
//   - teamId (UUID): The team ID
//   - requirementId (UUID): The requirement ID
//
// Query Params: None
// Body: None
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/submissions/:teamId/:requirementId',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    const teamId = c.req.param('teamId');
    const requirementId = c.req.param('requirementId');

    logInfo(
      'admin.submissions.file',
      `Fetching submission file for team ${teamId}, requirement ${requirementId}`,
    );

    try {
      const db = createDb(c.env);
      const storage = getStorage(c.env);

      logInfo(
        'admin.submissions.file',
        `Querying database for submission - teamId: ${teamId}, requirementId: ${requirementId}`,
      );

      // Fetch the submission record
      const submissionRepo = createDrizzleSubmissionRepo(db);
      const submission = await submissionRepo.getSubmissionByRequirement(teamId, requirementId);

      if (!submission) {
        logError(
          'admin.submissions.file',
          `Submission not found for team ${teamId}, requirement ${requirementId}`,
        );
        return c.json({ error: 'Submission not found' }, 404);
      }

      logInfo(
        'admin.submissions.file',
        `Found submission - fileUrl: ${submission.fileUrl}`,
      );

      // Create signed download URL
      const fileUrl = submission.fileUrl;
      if (!fileUrl) {
        logError(
          'admin.submissions.file',
          `Submission has no fileUrl - team ${teamId}, requirement ${requirementId}`,
        );
        return c.json({ error: 'Submission file URL is missing' }, 400);
      }

      const pathWithoutBucket = fileUrl.startsWith('wildcat2026/')
        ? fileUrl.substring('wildcat2026/'.length)
        : fileUrl;

      logInfo(
        'admin.submissions.file',
        `Creating signed URL for path: ${pathWithoutBucket}`,
      );

      const { data: signedUrl, error: urlError } = await storage.createSignedDownloadUrl(
        pathWithoutBucket,
        3600, // 1 hour
      );

      if (urlError || !signedUrl) {
        logError(
          'admin.submissions.file',
          `Could not create signed URL - team ${teamId}, requirement ${requirementId}, error: ${urlError?.message ?? 'unknown'}`,
        );
        return c.json({ error: 'Failed to generate download URL', details: String(urlError) }, 500);
      }

      const duration = Date.now() - startTime;
      logInfo(
        'admin.submissions.file',
        `Successfully generated signed URL for team ${teamId}, requirement ${requirementId} (${duration}ms)`,
      );

      return c.json({ success: true, data: { signedUrl } });
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.submissions.file',
        `Error fetching submission file (${duration}ms):`,
        error,
      );
      return c.json(
        { error: 'Failed to fetch submission file', details: String(error) },
        500,
      );
    }
  },
);

export default admin;
