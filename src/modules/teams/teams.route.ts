import { Hono } from 'hono';
import { handleCreateTeam } from './teams.controller.js';

const teams = new Hono()

teams.post('', handleCreateTeam)

export default teams
