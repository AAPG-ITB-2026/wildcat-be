import { Hono } from 'hono';
import { handleUpdateMember as handleUpdateMember, handleGetMember } from './members.controller.js';
import type { Env, Variables } from '../../types/index.js';

/*
 * GET    /api/members/:id
 *   Returns a single member by their member ID.
 *
 * PATCH  /api/members/:id
 *   Partially update a member's info.
 *   Body: any subset of { fullName, major }
 *
 * DELETE /api/members/:id
 *   Remove a member from their team.
 *
 * -- Member creation and team-scoped listing are under /api/teams/:id/members (see teams.route.ts),
 *  This is because it requires teamID
 */

const membersRoute = new Hono<{ Bindings: Env; Variables: Variables }>()

membersRoute.get('/', (c) => {
  return c.json({
    message: "Members endpoint is working",
    timestamp: new Date().toISOString(),
    debug: true
  });
});
membersRoute.get('/:id', handleGetMember)
membersRoute.patch('/:id', handleUpdateMember)
membersRoute.delete('/:id', handleUpdateMember)

export default membersRoute
