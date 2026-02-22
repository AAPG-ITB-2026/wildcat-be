import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { teams } from "../../db/schema.js";
import z from "zod";

export const insertTeamSchema = createInsertSchema(teams, {
    // TODO: adjust with actual constraints
    teamName: (schema) => schema.min(3).max(50),
    leaderName: (schema) => schema.min(2),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    status: true,
})

// TODO: clarify - can leaders change?
export const updateTeamSchema = insertTeamSchema.omit({}).partial();

export const teamIdParamSchema = z.object({
    teamId: z.string().uuid(),  // for auth/param validation
})

// TODO: add update teams info schema
//

export const selectTeamSchema = createSelectSchema(teams)
export const publicTeamSchema = selectTeamSchema.omit({
    id:true,
})
