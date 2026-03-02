import { Hono } from 'hono';
import { handleAddMember, handleGetAllTeamMembers, handleUpdateMember, handleDeleteMember } from './members.controller.js';
import type { Env, Variables } from '../../types/index.js';

/*
 * Members Routes — base: /api/members
 *
 * POST   /api/members/:teamId
 *   Add a member to an existing team (fills the first free m1 or m2 slot).
 *   Body: { fullName, major }
 *
 * GET    /api/members/:teamId
 *   Returns all members for a team (lead + m1 + m2 if set).
 *
 * PATCH  /api/members/:teamId/:slot
 *   Update a member slot (slot = m1 | m2).
 *   Body: any subset of { fullName, major }
 *
 * DELETE /api/members/:teamId/:slot
 *   Remove a member from a slot (slot = m1 | m2). Lead cannot be deleted.
 */

const membersRoute = new Hono<{ Bindings: Env; Variables: Variables }>()

membersRoute.post('/:teamId', handleAddMember)
membersRoute.get('/:teamId', handleGetAllTeamMembers)
membersRoute.patch('/:teamId/:slot', handleUpdateMember)
membersRoute.delete('/:teamId/:slot', handleDeleteMember)

export default membersRoute
