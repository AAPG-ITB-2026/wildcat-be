import { Hono } from 'hono';
import { handleCreateTeam, handleGetAllTeams, handleGetTeamById, handleUpdateTeam } from './teams.controller.js';
import type { Env, Variables } from '../../types/index.js';

/*
 * Teams Routes — base: /api/teams
 *
 * POST   /api/teams
 * Create a new team. Leader fields required; m1/m2 member fields optional.
 * Body: { competitionId, teamName, institution, phoneNumber, lineId,
 *           leadName, leadMajor, m1Name?, m1Major?, m2Name?, m2Major? }
 *
 * GET    /api/teams
 * Returns all teams.
 *
 * GET    /api/teams/:id
 * Returns a single team by ID.
 *
 * PATCH  /api/teams/:id
 * Partially update a team's fields.
 */

const teamsRoute = new Hono<{ Bindings: Env; Variables: Variables }>()

teamsRoute.get('/', handleGetAllTeams)
teamsRoute.post('/', handleCreateTeam)

teamsRoute.get('/:id', handleGetTeamById)
teamsRoute.patch('/:id', handleUpdateTeam)

export default teamsRoute
