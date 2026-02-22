import { Hono } from 'hono';
import { handleCreateTeam, handleGetAllTeams, handleGetTeamById, handleUpdateTeam } from './teams.controller.js';
import { handleAddMember, handleGetAllTeamMembers } from '../members/members.controller.js'

const teamsRoute = new Hono()

teamsRoute.post('', handleCreateTeam)
teamsRoute.get('', handleGetAllTeams)
teamsRoute.get('/:id', handleGetTeamById)
teamsRoute.patch('/:id', handleUpdateTeam)
teamsRoute.post('/:id/members', handleAddMember)
teamsRoute.get('/:id/members', handleGetAllTeamMembers)

export default teamsRoute
