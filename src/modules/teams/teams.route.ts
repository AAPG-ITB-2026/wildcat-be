import { Hono } from 'hono';
import {
	handleCreateTeam,
	handleGetAllTeams,
	handleGetMyResults,
	handleGetTeamById,
	handleUpdateTeam,
} from './teams.controller.js';
import { handleAddMember, handleGetAllTeamMembers } from '../members/members.controller.js'
import type { Env, Variables } from '../../types/index.js';
import { authMiddleware } from '../../middlewares/auth.js';

/*
 * Teams Routes — base: /api/teams
 *
 * POST   /api/teams
 *   Create a new team. Leader is required; up to 2 additional members optional.
 *   Body: { userId, teamName, leaderName, leaderMajor, university, category,
 *           additionalMembers?: [{ fullName, major }, ...] (max 2) }
 *
 * GET    /api/teams
 *   Returns all teams.
 *
 * GET    /api/teams/:id
 *   Returns a single team by ID.
 *
 * PATCH  /api/teams/:id
 *   Partially update a team's fields.
 *   Body: any subset of { userId, teamName, leaderName, leaderMajor, university, category }
 *
 * POST   /api/teams/:id/members
 *   Add a member to an existing team (max 3 total including leader).
 *   Body: { fullName, major }
 *
 * GET    /api/teams/:id/members
 *   Returns all members belonging to a team.
 */

const teamsRoute = new Hono<{ Bindings: Env; Variables: Variables }>()

teamsRoute.use('/my-results', authMiddleware);

teamsRoute.get('/', handleGetAllTeams)
teamsRoute.post('/', handleCreateTeam)

teamsRoute.get('/my-results', handleGetMyResults)

teamsRoute.get('/:id', handleGetTeamById)
teamsRoute.patch('/:id', handleUpdateTeam)

teamsRoute.get('/:id/members', handleGetAllTeamMembers)
teamsRoute.post('/:id/members', handleAddMember)
export default teamsRoute
