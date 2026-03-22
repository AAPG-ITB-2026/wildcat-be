import { Hono } from 'hono';
import { z } from 'zod';
import { eq, sql, desc, ne, isNotNull, inArray } from 'drizzle-orm';
import { createDb } from '../../db/index.js';
import { appConfig, appContent, announcements, teamAdministration, teamAccounts, competitions, competitionStages, events, eventRegistrationLogs, committeeAccounts, transactions } from '../../db/schema.js';
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


admin.route('/export', exportRouter);

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
    logInfo('admin.committee', 'Fetching all active committee members (excluding admins)');

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
        .from(committeeAccounts)
        .where(
          // Only fetch active Committee members (exclude Admins for safety)
          sql`${committeeAccounts.isActive} = true AND ${committeeAccounts.role} = 'Committee'`
        );

      const duration = Date.now() - startTime;
      logInfo(
        'admin.committee',
        `Successfully fetched ${committeeMembers.length} active committee members (${duration}ms)`,
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
  id: z.string().uuid('id must be a valid UUID').optional().nullable(),
  email: z.string().optional().nullable(),
  name: z.string().min(1, 'name cannot be empty').optional(),
  role: z.enum(['Admin', 'Committee']).optional(),
  division: z.string().min(1, 'division cannot be empty').optional(),
}).transform((data) => {
  // Convert null/empty values to undefined for easier checking
  return {
    id: data.id || undefined,
    email: (data.email && data.email.trim()) || undefined,
    name: data.name,
    role: data.role,
    division: data.division,
  };
}).refine(
  (data) => {
    // If id is provided, treat as update (only name/role/division needed)
    if (data.id) {
      return data.name !== undefined || data.role !== undefined || data.division !== undefined;
    }
    // If no id, treat as create (email + name + role + division required)
    // Also validate email format if provided in create mode
    if (data.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        return false;
      }
    }
    return data.email !== undefined && data.name !== undefined && data.role !== undefined && data.division !== undefined;
  },
  {
    message: 'Either provide id with fields to update (name/role/division), or provide email, name, role, and division to create',
    path: ['root'],
  }
);

admin.post(
  '/committee',
  committeeMiddleware({ roles: ['Admin'] }),
  async (c) => {
    const startTime = Date.now();
    const body = await c.req.json();
    logInfo('admin.committee.post', `Received request body: ${JSON.stringify(body)}`);
    const parsed = createCommitteeMemberSchema.safeParse(body);

    if (!parsed.success) {
      logError('admin.committee.post', `Validation failed: ${JSON.stringify(parsed.error.flatten())}`);
      return c.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        400,
      );
    }

    const { id, email, name, role, division } = parsed.data;
    const currentAdmin = c.get('committee');
    const db = createDb(c.env);

    // Mode 1: Update existing committee member (id provided)
    if (id) {
      logInfo('admin.committee.update', `Updating committee member: ${id}`);

      try {
        const updateData: Record<string, unknown> = {};
        if (name !== undefined) updateData.name = name;
        if (role !== undefined) updateData.role = role;
        if (division !== undefined) updateData.division = division;

        const [result] = await db
          .update(committeeAccounts)
          .set(updateData)
          .where(eq(committeeAccounts.id, id))
          .returning({
            id: committeeAccounts.id,
            name: committeeAccounts.name,
            role: committeeAccounts.role,
            division: committeeAccounts.division,
            isActive: committeeAccounts.isActive,
          });

        if (!result) {
          logError('admin.committee.update', `Committee member not found: ${id}`);
          return c.json(
            { error: 'Committee member not found' },
            404,
          );
        }

        const duration = Date.now() - startTime;
        logInfo(
          'admin.committee.update',
          `Successfully updated committee member ${id} (${duration}ms)`,
        );

        return c.json(
          {
            success: true,
            message: 'Committee member updated successfully',
            member: result,
          },
          200,
        );
      } catch (error) {
        const duration = Date.now() - startTime;
        logError(
          'admin.committee.update',
          `Error updating committee member (${duration}ms):`,
          error,
        );
        return c.json(
          {
            error: 'Failed to update committee member',
            details: String(error),
          },
          500,
        );
      }
    }

    // Mode 2: Create new committee member (email provided)
    logInfo('admin.committee.create', `Creating new committee member: ${email}`);

    try {
      // Step 1: Create user in Supabase Auth
      const supabaseUrl = c.env.SUPABASE_URL;
      const supabaseServiceKey = c.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseServiceKey) {
        logError(
          'admin.committee.create',
          'Missing Supabase configuration (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)',
        );
        return c.json(
          {
            error: 'Server configuration error',
            details: 'Supabase credentials not configured',
          },
          500,
        );
      }

      const authResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          email,
          user_metadata: {
            name,
            role,
            division,
          },
          email_confirm: true, // Auto-confirm email
        }),
      });

      if (!authResponse.ok) {
        const authError = await authResponse.text();
        logError(
          'admin.committee.create',
          `Failed to create Supabase user: ${authResponse.status} ${authError}`,
        );
        return c.json(
          {
            error: 'Failed to create Supabase user',
            details: authError,
          },
          400,
        );
      }

      const authData = (await authResponse.json()) as { id?: string; [key: string]: unknown };
      logInfo(
        'admin.committee.create',
        `Supabase response: ${JSON.stringify(authData)}`,
      );

      if (!authData || !authData.id) {
        logError(
          'admin.committee.create',
          `Supabase response missing id: ${JSON.stringify(authData)}`,
        );
        return c.json(
          {
            error: 'Failed to create Supabase user',
            details: 'Invalid Supabase response - missing user ID',
          },
          400,
        );
      }

      const userId = authData.id;

      logInfo(
        'admin.committee.create',
        `Created Supabase user ${userId} for ${email}`,
      );

      // Step 2: Insert into committeeAccounts table
      const [result] = await db
        .insert(committeeAccounts)
        .values({
          id: userId as any, // Use Supabase auth user ID
          name,
          role,
          division,
          isActive: true,
        } as any)
        .returning({
          id: committeeAccounts.id,
          name: committeeAccounts.name,
          role: committeeAccounts.role,
          division: committeeAccounts.division,
          isActive: committeeAccounts.isActive,
        });

      const duration = Date.now() - startTime;
      logInfo(
        'admin.committee.create',
        `Successfully created committee member ${userId} (${email}) (by ${currentAdmin.id}) in ${duration}ms`,
      );

      return c.json(
        {
          success: true,
          message: 'Committee member created and linked to Supabase Auth',
          member: result,
          note: 'User will receive an email confirmation. Set their password via Supabase dashboard if needed.',
        },
        201,
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(
        'admin.committee.create',
        `Error creating committee member (${duration}ms):`,
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
// PATCH /api/admin/committee/:memberId
// Update committee member details (name and division)
// Security: Admin role ONLY
//
// Description:
//   Updates a committee member's name and division. Email cannot be changed
//   as it is the unique identifier in Supabase Auth.
//
// Body:
//   {
//     "name": "John Updated",    // optional
//     "division": "Development"  // optional
//   }
//
// Response:
//   {
//     "success": true,
//     "message": "Committee member updated successfully",
//     "member": {
//       "id": "uuid",
//       "name": "John Updated",
//       "role": "Admin",
//       "division": "Development",
//       "isActive": true
//     }
//   }
//
// Path Params: memberId (UUID)
// ─────────────────────────────────────────────────────────────────────────────
const updateCommitteeDetailsSchema = z.object({
  name: z.string().min(1, 'name cannot be empty').optional(),
  division: z.string().min(1, 'division cannot be empty').optional(),
});

admin.patch(
  '/committee/:memberId',
  committeeMiddleware({ roles: ['Admin'] }),
  async (c) => {
    const startTime = Date.now();
    const memberId = c.req.param('memberId');

    logInfo('admin.committee.update', `Updating details for committee member ${memberId}`);

    try {
      const body = await c.req.json();
      const parsed = updateCommitteeDetailsSchema.safeParse(body);

      if (!parsed.success) {
        logError(
          'admin.committee.update',
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

      const { name, division } = parsed.data;
      const db = createDb(c.env);

      // Verify committee member exists
      const [memberExists] = await db
        .select({ id: committeeAccounts.id })
        .from(committeeAccounts)
        .where(eq(committeeAccounts.id, memberId))
        .limit(1);

      if (!memberExists) {
        logError('admin.committee.update', `Committee member not found: ${memberId}`);
        return c.json({ error: 'Committee member not found' }, 404);
      }

      // Prepare update payload - only include fields that were provided
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (division !== undefined) updateData.division = division;

      if (Object.keys(updateData).length === 0) {
        return c.json(
          {
            error: 'No fields to update',
            message: 'Please provide at least one field to update (name or division)',
          },
          400,
        );
      }

      // Update the committee member
      const [updated] = await db
        .update(committeeAccounts)
        .set(updateData)
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
        'admin.committee.update',
        `Successfully updated committee member ${memberId} (${duration}ms)`,
      );

      return c.json({
        success: true,
        message: 'Committee member updated successfully',
        member: updated,
      });
    } catch (error) {
      logError('admin.committee.update', `Failed to update committee member ${memberId}`, error);
      return c.json(
        { error: 'Failed to update committee member details', details: String(error) },
        500,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/committee/:memberId
// Deactivate a committee member
// Security: Admin role ONLY
//
// Description:
//   Deactivates a committee member (soft delete). Instead of permanently removing them
//   from the database, we mark them as inactive. This preserves their audit trail
//   (verification history, created content, etc.) while preventing them from accessing
//   admin features.
//
// Response:
//   {
//     "success": true,
//     "message": "Committee member deactivated successfully",
//     "memberId": "uuid",
//     "member": {
//       "id": "uuid",
//       "name": "Name",
//       "role": "Admin" | "Committee",
//       "division": "string",
//       "isActive": false
//     }
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

    logInfo('admin.committee.deactivate', `Deactivating committee member ${memberId}`);

    try {
      const db = createDb(c.env);
      const currentAdmin = c.get('committee');

      // Verify committee member exists before deactivating
      const [memberExists] = await db
        .select({ id: committeeAccounts.id, name: committeeAccounts.name })
        .from(committeeAccounts)
        .where(eq(committeeAccounts.id, memberId))
        .limit(1);

      if (!memberExists) {
        logError('admin.committee.deactivate', `Committee member not found: ${memberId}`);
        return c.json({ error: 'Committee member not found' }, 404);
      }

      // Deactivate the committee member (soft delete)
      const [result] = await db
        .update(committeeAccounts)
        .set({ isActive: false })
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
        'admin.committee.deactivate',
        `Successfully deactivated committee member ${memberId} (by ${currentAdmin.id}) in ${duration}ms`,
      );

      return c.json(
        {
          success: true,
          message: 'Committee member deactivated successfully',
          memberId,
          member: result,
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

      const teamIds = teams.map((t) => t.id);

      const allTransactions = teamIds.length > 0
        ? await db
            .select({
              teamId: transactions.teamId,
              verificationStatus: transactions.verificationStatus,
              amount: transactions.amount,
              createdAt: transactions.createdAt,
            })
            .from(transactions)
            .where(inArray(transactions.teamId, teamIds))
            .orderBy(desc(transactions.createdAt))
        : [];

      const txMap = new Map<string, (typeof allTransactions)[0]>();
      for (const tx of allTransactions) {
        if (!txMap.has(tx.teamId)) txMap.set(tx.teamId, tx);
      }

      const allDocs = teamIds.length > 0
        ? await db
            .select({
              teamId: teamAdministration.teamId,
              verificationStatus: teamAdministration.verificationStatus,
            })
            .from(teamAdministration)
            .where(inArray(teamAdministration.teamId, teamIds))
        : [];

      const docMap = new Map<string, (typeof allDocs)[0]>();
      for (const doc of allDocs) {
        if (!docMap.has(doc.teamId)) docMap.set(doc.teamId, doc);
      }

      const teamsWithStatus = teams.map((team) => {
        const latestTransaction = txMap.get(team.id);
        const docVerification = docMap.get(team.id);

        return {
          ...team,
          status: {
            paymentStatus: latestTransaction?.verificationStatus ?? 'None',
            documentVerificationStatus: docVerification?.verificationStatus ?? 'Pending',
            paymentAmount: latestTransaction?.amount ?? null,
            paymentVerifiedAt: latestTransaction?.createdAt ?? null,
          },
        };
      });

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



// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/config
// Toggle global flags: RELEASE_SCORES or MAINTENANCE_MODE
// Body: { key: "RELEASE_SCORES" | "MAINTENANCE_MODE", value: "true" | "false" }
// ─────────────────────────────────────────────────────────────────────────────
const configSchema = z.object({
  key: z.enum(['RELEASE_SCORES', 'MAINTENANCE_MODE']),
  value: z.enum(['true', 'false']),
});

admin.patch('/config', committeeMiddleware({ roles: ['Admin'] }), async (c) => {
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

admin.put('/content/:section', committeeMiddleware({ roles: ['Admin'] }), async (c) => {
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
 * Calculate document completeness based on team size
 * Returns which documents are missing based on actual team member count
 * Also validates that no extra documents were submitted for non-existent members
 */
function validateDocuments(admin: {
  leadKtm: string | null;
  m1Ktm: string | null;
  m2Ktm: string | null;
  twibbonProof: string | null;
  posterProof: string | null;
}, teamMemberCount: number): {
  isComplete: boolean;
  missingDocs: Array<{ name: string; type: string }>;
  submittedDocs: Array<{ name: string; type: string }>;
  invalidDocs: Array<{ name: string; type: string }>;
} {
  const requiredDocs = [
    { name: 'Lead Student ID Card (KTM)', type: 'leadKtm', value: admin.leadKtm, required: true },
    { name: 'Member 1 Student ID Card (KTM)', type: 'm1Ktm', value: admin.m1Ktm, required: teamMemberCount > 1 },
    { name: 'Member 2 Student ID Card (KTM)', type: 'm2Ktm', value: admin.m2Ktm, required: teamMemberCount > 2 },
    { name: 'Twibbon Proof', type: 'twibbonProof', value: admin.twibbonProof, required: true },
    { name: 'Poster Proof', type: 'posterProof', value: admin.posterProof, required: true },
  ];

  const missingDocs = requiredDocs
    .filter((doc) => doc.required && !doc.value)
    .map((doc) => ({ name: doc.name, type: doc.type }));
  
  const submittedDocs = requiredDocs
    .filter((doc) => doc.value)
    .map((doc) => ({ name: doc.name, type: doc.type }));

  // Check for documents submitted for non-existent members
  const invalidDocs = [];
  if (admin.m1Ktm && teamMemberCount <= 1) {
    invalidDocs.push({ name: 'Member 1 Student ID Card (KTM)', type: 'm1Ktm' });
  }
  if (admin.m2Ktm && teamMemberCount <= 2) {
    invalidDocs.push({ name: 'Member 2 Student ID Card (KTM)', type: 'm2Ktm' });
  }

  return {
    isComplete: missingDocs.length === 0 && invalidDocs.length === 0,
    missingDocs,
    submittedDocs,
    invalidDocs,
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

    // Fetch team administration with all document fields AND team member info
    const [teamWithAdmin] = await db
      .select({
        teamId: teamAdministration.teamId,
        leadKtm: teamAdministration.leadKtm,
        m1Ktm: teamAdministration.m1Ktm,
        m2Ktm: teamAdministration.m2Ktm,
        twibbonProof: teamAdministration.twibbonProof,
        posterProof: teamAdministration.posterProof,
        m1Name: teamAccounts.m1Name,
        m2Name: teamAccounts.m2Name,
      })
      .from(teamAdministration)
      .innerJoin(teamAccounts, eq(teamAdministration.teamId, teamAccounts.id))
      .where(eq(teamAdministration.teamId, teamId))
      .limit(1);

    if (!teamWithAdmin) {
      return c.json({ error: 'Team administration record not found' }, 404);
    }

    // Count team members (lead is always present, m1 and m2 optional)
    const teamMemberCount = 1 + (teamWithAdmin.m1Name ? 1 : 0) + (teamWithAdmin.m2Name ? 1 : 0);

    // Validate documents based on actual team member count
    const docValidation = validateDocuments({
      leadKtm: teamWithAdmin.leadKtm,
      m1Ktm: teamWithAdmin.m1Ktm,
      m2Ktm: teamWithAdmin.m2Ktm,
      twibbonProof: teamWithAdmin.twibbonProof,
      posterProof: teamWithAdmin.posterProof,
    }, teamMemberCount);

    // Determine final action and rejection notes
    let finalAction = action;
    let rejectionNotes: string | null = null;
    let wasAutoRejected = false;

    if (!docValidation.isComplete) {
      // AUTO-REJECT: Always reject if documents are incomplete or invalid
      finalAction = 'Rejected';
      wasAutoRejected = true;

      const submittedList = docValidation.submittedDocs.length > 0 
        ? `Submitted documents:\n${docValidation.submittedDocs.map((doc) => `✓ ${doc.name}`).join('\n')}\n\n`
        : '';

      const missingList = docValidation.missingDocs.length > 0
        ? `Missing documents:\n${docValidation.missingDocs.map((doc) => `✗ ${doc.name}`).join('\n')}\n\n`
        : '';

      const invalidList = docValidation.invalidDocs.length > 0
        ? `Invalid documents (submitted for non-existent members):\n${docValidation.invalidDocs.map((doc) => `✗ ${doc.name}`).join('\n')}\n\n`
        : '';

      rejectionNotes = `Your document submission is incomplete or invalid and has been automatically rejected.\n\n${submittedList}${missingList}${invalidList}Please ensure all uploaded documents correspond to actual team members and upload any missing required documents, then resubmit for verification.`;
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

    // Fetch team details with payment status
    const [team] = await db
      .select({
        id: teamAccounts.id,
        teamName: teamAccounts.teamName,
        institution: teamAccounts.institution,
        leadName: teamAccounts.leadName,
        competitionId: teamAccounts.competitionId,
        currentStageId: teamAccounts.currentStageId,
        createdAt: teamAccounts.createdAt,
      })
      .from(teamAccounts)
      .where(eq(teamAccounts.id, teamId))
      .limit(1);

    // If documents are now verified AND no stage assigned yet
    // Assign them to their first stage (don't wait for payment)
    let stageAssignmentStatus: { assigned: boolean; reason?: string; stageId?: string; stageName?: string } = {
      assigned: false,
    };

    if (finalAction === 'Verified' && team && !team.currentStageId) {
      try {
        const allStages = await db
          .select()
          .from(competitionStages)
          .where(eq(competitionStages.competitionId, team.competitionId));

        if (allStages && allStages.length > 0) {
          // Sort stages: Preliminary first, then by startDate
          const preliminaryStages = allStages.filter(s => 
            s.name.toLowerCase().includes('preliminary')
          );
          
          const firstStage = preliminaryStages.length > 0 
            ? preliminaryStages.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0]
            : allStages.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];

          if (firstStage) {
            await db
              .update(teamAccounts)
              .set({ currentStageId: firstStage.id })
              .where(eq(teamAccounts.id, teamId));

            logInfo('admin.verify', `Team ${teamId} assigned to stage after document verification`, {
              stageId: firstStage.id,
              stageName: firstStage.name,
            });

            stageAssignmentStatus = {
              assigned: true,
              stageId: firstStage.id,
              stageName: firstStage.name,
            };
          }
        } else {
          stageAssignmentStatus = {
            assigned: false,
            reason: 'No competition stages configured',
          };
          logError('admin.verify', `No stages found for competition ${team.competitionId}`);
        }
      } catch (stageError) {
        // Log error but don't fail the verification
        stageAssignmentStatus = {
          assigned: false,
          reason: `Stage assignment failed: ${stageError instanceof Error ? stageError.message : String(stageError)}`,
        };
        logError('admin.verify', 'Failed to assign team to stage after document verification', stageError);
      }
    } else if (finalAction === 'Verified' && team && team.currentStageId) {
      stageAssignmentStatus = {
        assigned: false,
        reason: 'Team already has stage assigned',
      };
    }

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
      stageAssignment: stageAssignmentStatus,
      team,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/transactions
// List all payment submissions with verification status.
// Security: Admin or Committee role
//
// Description:
//   Retrieves all team payment submissions grouped by verification status
//   (Pending, Verified, Rejected). Allows admins to review and manage
//   payment verifications across all teams.
//
// Response:
//   {
//     "success": true,
//     "data": {
//       "total": 25,
//       "byStatus": {
//         "Pending": [
//           {
//             "id": "uuid",
//             "teamId": "uuid",
//             "teamName": "Team A",
//             "amount": "500000.00",
//             "paymentType": "Bank Transfer",
//             "verificationStatus": "Pending",
//             "createdAt": "2024-01-15T10:30:00Z"
//           }
//         ],
//         "Verified": [...],
//         "Rejected": [...]
//       }
//     }
//   }
admin.get(
  '/transactions',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    
    try {
      const user = c.get('user');
      const committee = c.get('committee');

      const db = createDb(c.env);
      const storage = getStorage(c.env);

      // Fetch only MANUAL transactions (ones with paymentProofUrl - requires admin verification)
      const allTransactions = await db
        .select({
          id: transactions.id,
          teamId: transactions.teamId,
          teamName: teamAccounts.teamName,
          competitionName: competitions.name,
          amount: transactions.amount,
          paymentType: transactions.paymentType,
          paymentProofUrl: transactions.paymentProofUrl,
          verificationStatus: transactions.verificationStatus,
          rejectionNotes: transactions.rejectionNotes,
          verifiedBy: transactions.verifiedBy,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .innerJoin(teamAccounts, eq(transactions.teamId, teamAccounts.id))
        .innerJoin(competitions, eq(teamAccounts.competitionId, competitions.id))
        .where(isNotNull(transactions.paymentProofUrl)) // Only manual payments with proof
        .orderBy(desc(transactions.createdAt));

      // Generate signed URLs for each transaction
      const transactionsWithUrls = await Promise.all(
        allTransactions.map(async (txn) => {
          let signedUrl: string | null = null;
          if (txn.paymentProofUrl) {
            try {
              const pathWithoutBucket = txn.paymentProofUrl.startsWith('wildcat2026/')
                ? txn.paymentProofUrl.substring('wildcat2026/'.length)
                : txn.paymentProofUrl;

              const { data: url, error: urlError } = await storage.createSignedDownloadUrl(
                pathWithoutBucket,
                3600,
              );

              if (!urlError && url) {
                signedUrl = url;
              }
            } catch (error) {
              // Silent fail for URL generation
            }
          }

          return {
            id: txn.id,
            teamId: txn.teamId,
            teamName: txn.teamName,
            competitionName: txn.competitionName,
            amount: txn.amount,
            paymentType: txn.paymentType,
            paymentProofUrl: signedUrl,
            verificationStatus: txn.verificationStatus,
            rejectionNotes: txn.rejectionNotes,
            verifiedBy: txn.verifiedBy,
            createdAt: txn.createdAt,
          };
        }),
      );

      // Group by verification status
      const byStatus: Record<string, typeof transactionsWithUrls> = {
        Pending: [],
        Verified: [],
        Rejected: [],
      };

      for (const txn of transactionsWithUrls) {
        const status = txn.verificationStatus as keyof typeof byStatus;
        if (byStatus[status]) {
          byStatus[status].push(txn);
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[GET] /api/admin/transactions - 200 (${duration}ms)`);
      
      return c.json({
        success: true,
        totalTransactions: transactionsWithUrls.length,
        pendingCount: byStatus.Pending.length,
        verifiedCount: byStatus.Verified.length,
        rejectedCount: byStatus.Rejected.length,
        transactions: transactionsWithUrls,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`[GET] /api/admin/transactions - 500 (${duration}ms)`);
      console.error('[admin.transactions.list]', error);
      return c.json({ error: 'Failed to fetch transactions' }, 500);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/transactions/:transaction_id
// Preview a team's payment submission with signed download URL.
// Security: Admin or Committee role
//
// Description:
//   Allows admins to view payment submission details and preview the payment
//   proof file before verifying or rejecting it. Returns a 1-hour signed download
//   URL for secure file access without exposing R2 credentials.
//
// Response:
//   {
//     "success": true,
//     "data": {
//       "id": "uuid",
//       "teamId": "uuid",
//       "teamName": "Team A",
//       "amount": "500000.00",
//       "paymentType": "Bank Transfer",
//       "paymentProofUrl": "signed-download-url",
//       "verificationStatus": "Pending" | "Verified" | "Rejected",
//       "rejectionNotes": "string or null",
//       "verifiedBy": "admin-uuid or null",
//       "createdAt": "2024-01-15T10:30:00Z"
//     }
//   }
//
// Path Params: transaction_id (UUID)
//
// Error Responses:
//   - 404: Transaction not found
//   - 500: Database error
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/transactions/:transaction_id',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    const transactionId = c.req.param('transaction_id');

    console.log('[admin.transactions.preview] ===== START GET /transactions/:transaction_id =====');
    
    console.log('[admin.transactions.preview] ─── PATH PARAMETERS ───');
    console.log('[admin.transactions.preview] Transaction ID:', transactionId);
    console.log('[admin.transactions.preview] Transaction ID type:', typeof transactionId);
    console.log('[admin.transactions.preview] Transaction ID length:', transactionId?.length);

    logInfo('admin.transactions.preview', `Previewing transaction ${transactionId}`);

    try {
      const user = c.get('user');
      const committee = c.get('committee');
      
      console.log('[admin.transactions.preview] ─── REQUEST CONTEXT ───');
      console.log('[admin.transactions.preview] User ID:', user?.id);
      console.log('[admin.transactions.preview] User ID type:', typeof user?.id);
      console.log('[admin.transactions.preview] Committee ID:', committee?.id);
      console.log('[admin.transactions.preview] Committee role:', committee?.role);
      console.log('[admin.transactions.preview] Committee division:', committee?.division);
      
      const db = createDb(c.env);
      const storage = getStorage(c.env);

      // Fetch transaction with team info
      console.log('[admin.transactions.preview] ─── DATABASE QUERY ───');
      console.log('[admin.transactions.preview] ⏳ Querying for transaction:', transactionId);
      const [transaction] = await db
        .select({
          id: transactions.id,
          teamId: transactions.teamId,
          teamName: teamAccounts.teamName,
          amount: transactions.amount,
          paymentType: transactions.paymentType,
          paymentProofUrl: transactions.paymentProofUrl,
          verificationStatus: transactions.verificationStatus,
          rejectionNotes: transactions.rejectionNotes,
          verifiedBy: transactions.verifiedBy,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .innerJoin(teamAccounts, eq(transactions.teamId, teamAccounts.id))
        .where(eq(transactions.id, transactionId))
        .limit(1);

      if (!transaction) {
        console.log('[admin.transactions.preview] ❌ Transaction not found:', transactionId);
        logError('admin.transactions.preview', `Transaction not found: ${transactionId}`);
        return c.json({ error: 'Transaction not found' }, 404);
      }

      console.log('[admin.transactions.preview] ✅ Found transaction in database');
      console.log('[admin.transactions.preview] ─── FULL TRANSACTION DATA ───');
      console.log('[admin.transactions.preview] Transaction object:', JSON.stringify(transaction, null, 2));

      // Generate signed download URL if payment proof exists
      let signedUrl: string | null = null;
      if (transaction.paymentProofUrl) {
        console.log('[admin.transactions.preview] ─── SIGNED URL GENERATION ───');
        console.log('[admin.transactions.preview] ⏳ Payment proof URL found:', transaction.paymentProofUrl);
        try {
          const pathWithoutBucket = transaction.paymentProofUrl.startsWith('wildcat2026/')
            ? transaction.paymentProofUrl.substring('wildcat2026/'.length)
            : transaction.paymentProofUrl;

          console.log('[admin.transactions.preview] Original path:', transaction.paymentProofUrl);
          console.log('[admin.transactions.preview] Path without bucket:', pathWithoutBucket);
          console.log('[admin.transactions.preview] ⏳ Calling storage.createSignedDownloadUrl()...');

          const { data: url, error: urlError } = await storage.createSignedDownloadUrl(
            pathWithoutBucket,
            3600, // 1 hour
          );

          console.log('[admin.transactions.preview] API call response:', {
            hasUrl: !!url,
            hasError: !!urlError,
            errorMessage: urlError?.message,
          });

          if (!urlError && url) {
            signedUrl = url;
            console.log('[admin.transactions.preview] ✅ Successfully created signed URL');
            console.log('[admin.transactions.preview] Full signed URL:', url);
            console.log('[admin.transactions.preview] Signed URL length:', url.length);
          } else {
            console.log('[admin.transactions.preview] ❌ Failed to create signed URL:', urlError?.message);
            logInfo(
              'admin.transactions.preview',
              `Could not create signed URL for transaction ${transactionId}`,
            );
          }
        } catch (error) {
          console.log('[admin.transactions.preview] ❌ Exception during signed URL generation:', error);
          if (error instanceof Error) {
            console.log('[admin.transactions.preview] Error message:', error.message);
            console.log('[admin.transactions.preview] Error stack:', error.stack);
          }
          logInfo(
            'admin.transactions.preview',
            `Error creating signed URL for transaction ${transactionId}`,
          );
        }
      } else {
        console.log('[admin.transactions.preview] ⚠️  No payment proof URL in transaction');
      }

      const duration = Date.now() - startTime;
      console.log('[admin.transactions.preview] ─── RESPONSE OBJECT ───');
      const responseObject = {
        success: true,
        data: {
          id: transaction.id,
          teamId: transaction.teamId,
          teamName: transaction.teamName,
          amount: transaction.amount,
          paymentType: transaction.paymentType,
          paymentProofUrl: signedUrl,
          verificationStatus: transaction.verificationStatus,
          rejectionNotes: transaction.rejectionNotes,
          verifiedBy: transaction.verifiedBy,
          createdAt: transaction.createdAt,
        },
      };
      console.log('[admin.transactions.preview] Full response object:', JSON.stringify(responseObject, null, 2));

      console.log(`[admin.transactions.preview] ===== SUCCESS (${duration}ms) =====`);
      logInfo(
        'admin.transactions.preview',
        `Successfully previewed transaction ${transactionId} (${duration}ms)`,
      );

      return c.json(responseObject, 200);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[admin.transactions.preview] ===== ERROR (${duration}ms) =====`);
      console.error('[admin.transactions.preview] Error details:', error);
      if (error instanceof Error) {
        console.error('[admin.transactions.preview] Error message:', error.message);
        console.error('[admin.transactions.preview] Error stack:', error.stack);
      }
      logError(
        'admin.transactions.preview',
        `Error previewing transaction (${duration}ms):`,
        error,
      );
      return c.json(
        { error: 'Failed to preview transaction', details: String(error) },
        500,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/transactions/:transaction_id/verify
// Verify or reject a team's manual payment.
// Body: { status: 'Verified' | 'Rejected', rejection_reason?: string }
// Security: CommitteeAccount middleware (Admin/Committee roles only)
// ─────────────────────────────────────────────────────────────────────────────
const verifyTransactionSchema = z.object({
  status: z.enum(['Verified', 'Rejected']),
  rejection_reason: z.string().min(1).optional(),
});

admin.patch(
  '/transactions/:transaction_id/verify',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const startTime = Date.now();
    const transactionId = c.req.param('transaction_id');
    
    console.log('[admin.transactions.verify] ===== START PATCH /transactions/:transaction_id/verify =====');
    
    console.log('[admin.transactions.verify] ─── PATH PARAMETERS ───');
    console.log('[admin.transactions.verify] Transaction ID:', transactionId);
    console.log('[admin.transactions.verify] Transaction ID type:', typeof transactionId);
    
    try {
      console.log('[admin.transactions.verify] ─── REQUEST BODY ───');
      const body = await c.req.json();
      console.log('[admin.transactions.verify] Raw request body:', JSON.stringify(body, null, 2));
      console.log('[admin.transactions.verify] Body keys:', Object.keys(body));
      console.log('[admin.transactions.verify] Body value types:', {
        status: typeof body.status,
        rejection_reason: typeof body.rejection_reason,
      });
      
      console.log('[admin.transactions.verify] ─── VALIDATION ───');
      const parsed = verifyTransactionSchema.safeParse(body);
      console.log('[admin.transactions.verify] Zod parse result:', {
        success: parsed.success,
        errors: parsed.success ? null : JSON.stringify(parsed.error.flatten(), null, 2),
      });

      if (!parsed.success) {
        console.log('[admin.transactions.verify] ❌ Validation failed');
        return c.json({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
      }

      const { status, rejection_reason } = parsed.data;
      console.log('[admin.transactions.verify] Parsed data (after Zod validation):', {
        status,
        rejection_reason,
        hasRejectionReason: !!rejection_reason,
        rejectionReasonLength: rejection_reason?.length,
      });

      if (status === 'Rejected' && !rejection_reason) {
        console.log('[admin.transactions.verify] ❌ Rejected status requires rejection_reason');
        return c.json({ error: 'rejection_reason is required when status is "Rejected"' }, 400);
      }

      console.log('[admin.transactions.verify] ─── REQUEST CONTEXT ───');
      const user = c.get('user');
      const committee = c.get('committee');
      console.log('[admin.transactions.verify] User ID:', user?.id);
      console.log('[admin.transactions.verify] User ID type:', typeof user?.id);
      console.log('[admin.transactions.verify] Committee ID:', committee?.id);
      console.log('[admin.transactions.verify] Committee role:', committee?.role);
      console.log('[admin.transactions.verify] Committee division:', committee?.division);
      console.log('[admin.transactions.verify] Committee name:', committee?.name);
      console.log('[admin.transactions.verify] Committee is active:', committee?.isActive);
      
      const db = createDb(c.env);

      // Verify transaction exists
      console.log('[admin.transactions.verify] ─── DATABASE QUERY (BEFORE) ───');
      console.log('[admin.transactions.verify] ⏳ Querying for existing transaction:', transactionId);
      const [existing] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);

      if (!existing) {
        console.log('[admin.transactions.verify] ❌ Transaction not found:', transactionId);
        return c.json({ error: 'Transaction not found' }, 404);
      }

      console.log('[admin.transactions.verify] ✅ Found existing transaction');
      console.log('[admin.transactions.verify] Existing transaction (full data):', JSON.stringify(existing, null, 2));

      console.log('[admin.transactions.verify] ─── DATABASE UPDATE ───');
      console.log(`[admin.transactions.verify] ⏳ Updating status: "${existing.verificationStatus}" → "${status}"`);
      const updatePayload = {
        verificationStatus: status,
        verifiedBy: committee.id,
        rejectionNotes: status === 'Rejected' ? (rejection_reason ?? null) : null,
      };
      console.log('[admin.transactions.verify] Update payload:', JSON.stringify(updatePayload, null, 2));
      
      // Update transaction
      let updated = existing;
      await db.transaction(async (tx) => {
        const [result] = await tx
          .update(transactions)
          .set(updatePayload)
          .where(eq(transactions.id, transactionId))
          .returning();

        console.log('[admin.transactions.verify] ✅ Transaction updated successfully');
        console.log('[admin.transactions.verify] Updated transaction (full data):', JSON.stringify(result, null, 2));
        
        updated = result;
      });

      console.log('[admin.transactions.verify] ─── CHANGES SUMMARY ───');
      console.log('[admin.transactions.verify] Change log:', {
        transactionId: updated.id,
        statusChanged: `${existing.verificationStatus} → ${updated.verificationStatus}`,
        verifiedByCommittee: updated.verifiedBy,
        previousVerifiedBy: existing.verifiedBy,
        hasRejectionNotes: !!updated.rejectionNotes,
        rejectionNotesSet: status === 'Rejected' ? !!rejection_reason : false,
      });

      const duration = Date.now() - startTime;
      console.log('[admin.transactions.verify] ─── RESPONSE ───');
      const responseObject = {
        success: true,
        transaction: {
          id: updated.id,
          teamId: updated.teamId,
          verificationStatus: updated.verificationStatus,
          verifiedBy: updated.verifiedBy,
          rejectionNotes: updated.rejectionNotes,
        },
      };
      console.log('[admin.transactions.verify] Full response object:', JSON.stringify(responseObject, null, 2));

      console.log(`[admin.transactions.verify] ===== SUCCESS (${duration}ms) =====`);

      return c.json(responseObject);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[admin.transactions.verify] ===== ERROR (${duration}ms) =====`);
      console.error('[admin.transactions.verify] Error details:', error);
      if (error instanceof Error) {
        console.error('[admin.transactions.verify] Error message:', error.message);
        console.error('[admin.transactions.verify] Error stack:', error.stack);
      }
      return c.json({
        error: 'Failed to verify transaction',
        details: error instanceof Error ? error.message : String(error),
      }, 500);
    }
  },
);

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
    console.log('[admin.documents.teams] ===== START GET /documents/teams =====');
    logInfo('admin.documents.teams', 'Fetching all team administration documents');

    try {
      const user = c.get('user');
      console.log('[admin.documents.teams] User ID:', user?.id);
      console.log('[admin.documents.teams] User type:', typeof user?.id);
      
      const db = createDb(c.env);
      const storage = getStorage(c.env);

      // Fetch all team administrations with team details
      console.log('[admin.documents.teams] Querying database for team administrations...');
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

      console.log('[admin.documents.teams] ✅ Database query completed');
      console.log('[admin.documents.teams] Total teams found:', administrations.length);
      console.log('[admin.documents.teams] Sample team data:', {
        teamCount: administrations.length,
        firstTeamSample: administrations[0] ? {
          teamId: administrations[0].teamId,
          teamName: administrations[0].teamName,
          competition: administrations[0].competitionName,
          verificationStatus: administrations[0].verificationStatus,
          hasLeadKtm: !!administrations[0].leadKtm,
          hasM1Ktm: !!administrations[0].m1Ktm,
          hasM2Ktm: !!administrations[0].m2Ktm,
          hasTwibbonProof: !!administrations[0].twibbonProof,
          hasPosterProof: !!administrations[0].posterProof,
        } : null,
      });
      
      logInfo(
        'admin.documents.teams',
        `Found ${administrations.length} teams to process`,
      );

      // Transform to include signed URLs and document metadata
      console.log('[admin.documents.teams] Processing document URLs for each team...');
      const teams = await Promise.all(
        administrations.map(async (admin) => {
          console.log(`[admin.documents.teams] Processing team: ${admin.teamName} (${admin.teamId})`);
          
          // Helper to create signed URL if document exists
          const getDocumentUrl = async (filePath: string | null, docType: string): Promise<{ type: string; url: string | null; exists: boolean } | null> => {
            // Skip if no file path
            if (!filePath) {
              console.log(`[admin.documents.teams]   ⚠️  ${docType}: No file path`);
              return null;
            }

            try {
              console.log(`[admin.documents.teams]   ⏳ ${docType}: Generating signed URL for path: ${filePath.substring(0, 60)}...`);
              
              // Strip bucket name for R2 API
              const pathWithoutBucket = filePath.startsWith('wildcat2026/')
                ? filePath.substring('wildcat2026/'.length)
                : filePath;

              const { data: signedUrl, error: urlError } = await storage.createSignedDownloadUrl(
                pathWithoutBucket,
                3600,
              );
              
              if (urlError || !signedUrl) {
                console.log(`[admin.documents.teams]   ❌ ${docType}: Failed to generate signed URL - ${urlError?.message || 'Unknown error'}`);
                logInfo(
                  'admin.documents.teams',
                  `Could not create signed URL for ${docType} - team ${admin.teamId}`,
                );
                return null;
              }
              
              console.log(`[admin.documents.teams]   ✅ ${docType}: Successfully generated signed URL (${signedUrl.substring(0, 80)}...)`);
              return {
                type: docType,
                url: signedUrl,
                exists: true,
              };
            } catch (error) {
              console.log(`[admin.documents.teams]   ❌ ${docType}: Error generating signed URL -`, error);
              logInfo(
                'admin.documents.teams',
                `Skipped ${docType} for team ${admin.teamId}`,
              );
              return null;
            }
          };

          // Build documents array in parallel and filter out nulls
          console.log(`[admin.documents.teams]   Processing 5 document types in parallel...`);
          const docResults = await Promise.all([
            getDocumentUrl(admin.leadKtm, 'lead_ktm'),
            getDocumentUrl(admin.m1Ktm, 'm1_ktm'),
            getDocumentUrl(admin.m2Ktm, 'm2_ktm'),
            getDocumentUrl(admin.twibbonProof, 'twibbon_proof'),
            getDocumentUrl(admin.posterProof, 'poster_proof'),
          ]);

          const documents = docResults.filter((doc): doc is { type: string; url: string; exists: boolean } => doc !== null);
          
          console.log(`[admin.documents.teams]   Team ${admin.teamName}: Generated ${documents.length}/5 document URLs`);

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

      console.log('[admin.documents.teams] ✅ All teams processed');
      console.log('[admin.documents.teams] Response summary:', {
        totalTeams: teams.length,
        teamsWithDocuments: teams.filter(t => t.documents.length > 0).length,
        documentsByStatus: {
          Pending: teams.filter(t => t.verificationStatus === 'Pending').length,
          Verified: teams.filter(t => t.verificationStatus === 'Verified').length,
          Rejected: teams.filter(t => t.verificationStatus === 'Rejected').length,
        },
      });

      const duration = Date.now() - startTime;
      console.log(`[admin.documents.teams] ===== SUCCESS (${duration}ms) =====`);
      logInfo(
        'admin.documents.teams',
        `Successfully fetched ${teams.length} teams in ${duration}ms`,
      );

      return c.json({ teams });
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[admin.documents.teams] ===== ERROR (${duration}ms) =====`);
      console.error('[admin.documents.teams] Error details:', error);
      if (error instanceof Error) {
        console.error('[admin.documents.teams] Error message:', error.message);
        console.error('[admin.documents.teams] Error stack:', error.stack);
      }
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
// Team count and total participants (lead + members) per competition + grand totals
// Security: Admin or Committee role
// ─────────────────────────────────────────────────────────────────────────────
admin.get(
  '/metrics/competitions',
  committeeMiddleware({ roles: ['Admin', 'Committee'] }),
  async (c) => {
    const db = createDb(c.env);

    // Fetch all teams with member info
    const allTeams = await db
      .select({
        competitionId: teamAccounts.competitionId,
        competitionName: competitions.name,
        leadName: teamAccounts.leadName,
        m1Name: teamAccounts.m1Name,
        m2Name: teamAccounts.m2Name,
      })
      .from(teamAccounts)
      .rightJoin(competitions, eq(teamAccounts.competitionId, competitions.id));

    // Group by competition and calculate metrics
    const competitionMap = new Map<string, {
      competitionId: string;
      competitionName: string;
      teamCount: number;
      participantCount: number;
    }>();

    for (const team of allTeams) {
      if (!team.competitionId) continue; // Skip if no team in this competition

      const key = team.competitionId;
      if (!competitionMap.has(key)) {
        competitionMap.set(key, {
          competitionId: team.competitionId,
          competitionName: team.competitionName,
          teamCount: 0,
          participantCount: 0,
        });
      }

      const entry = competitionMap.get(key)!;
      entry.teamCount += 1;
      
      // Count participants: 1 (lead) + m1 (if exists) + m2 (if exists)
      let participantCount = 1; // Always has lead
      if (team.m1Name) participantCount += 1;
      if (team.m2Name) participantCount += 1;
      entry.participantCount += participantCount;
    }

    const rows = Array.from(competitionMap.values());

    const grandTotals = {
      teamCount: rows.reduce((acc, r) => acc + r.teamCount, 0),
      participantCount: rows.reduce((acc, r) => acc + r.participantCount, 0),
    };

    return c.json({
      competitions: rows,
      grandTotals,
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
