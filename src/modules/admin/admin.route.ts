import { Hono } from 'hono';
import type { Env, Variables } from '../../types/index.js';
import {
  handleGetAdministrationTeams,
  handleGetStageSubmissions,
  handleGetTransactions,
  handlePatchConfig,
  handlePatchReleaseScores,
  handlePostAnnouncement,
  handlePutContent,
} from './admin.controller.js';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.patch('/config', handlePatchConfig);

admin.put('/content/:section', handlePutContent);

admin.post('/announcements', handlePostAnnouncement);

admin.get('/transactions', handleGetTransactions);

admin.get('/teams/administration', handleGetAdministrationTeams);

admin.get('/stages/:stage_id/submissions', handleGetStageSubmissions);

admin.patch('/stages/:stage_id/release-scores', handlePatchReleaseScores);

export default admin;
