import { Hono } from 'hono';
import type { Env, Variables } from '../../types/index.js';
import { handleGetRegistrationCurves } from './analytics.controller.js';

/*
 * Analytics Routes — base: /api/admin/analytics
 *
 * GET     /api/admin/analytics/registration-curves
 * Returns daily + cumulative registration counts for competitions and side events.
 */

const analyticsRoute = new Hono<{ Bindings: Env; Variables: Variables }>()

analyticsRoute.get('/registration-curves', handleGetRegistrationCurves)

export default analyticsRoute
