import { createInsertSchema } from 'drizzle-zod';
import { members } from '../../db/schema.js';
import { z } from 'zod';

export const insertMemberSchema = createInsertSchema(members).omit({ 
  id: true,
  teamId: true // omit as it will be passed in url params
});

export const updateMemberSchema = insertMemberSchema.partial();
