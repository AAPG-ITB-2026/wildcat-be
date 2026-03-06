import { Hono } from 'hono';
import { handleGetEvents, handleJoinEvent } from './events.controller.js';
import type { Env, Variables } from '../../types/index.js';

/*
 * Events Routes — base: /api/events
 *
 * GET    /api/events
 * Returns all events.
 *
 * GET    /api/teams/:id
 * Returns a single team by ID.
 *
 * PATCH  /api/teams/:id
 * Partially update a team's fields.
 */

const eventsRoute = new Hono<{ Bindings: Env; Variables: Variables }>()

eventsRoute.get('', handleGetEvents)

export default eventsRoute
