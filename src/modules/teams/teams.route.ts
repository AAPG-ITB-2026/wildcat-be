import { Hono } from 'hono';
import { handleCreateTeam, handleGetAllTeams, handleGetTeamById } from './teams.controller.js';
import { handleAddMember, handleGetAllTeamMembers } from '../members/members.controller.js'

const teamsRoute = new Hono()

teamsRoute.post('', handleCreateTeam)
teamsRoute.get('', handleGetAllTeams)
teamsRoute.get('/:id', handleGetTeamById)
teamsRoute.post('/:id/members', handleAddMember)
teamsRoute.get('/:id/members', handleGetAllTeamMembers)

export default teamsRoute
