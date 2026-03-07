
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { members } from '../../db/schema.js';
import { z } from 'zod';

export const insertMemberSchema = createInsertSchema(members).omit({
    id: true,
    teamId: true // TODO: omit as it will be passed in url params
});

export const updateMemberSchema = insertMemberSchema.partial();

export const selectMemberSchema = createSelectSchema(members);

export const publicMemberSchema = selectMemberSchema.omit({
    id: true,
});
