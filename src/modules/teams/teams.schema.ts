import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { teamAccounts } from "../../db/schema.js";
import z from "zod";

// TODO: m1/m2 is janky for frontend, should be discussed further
const m1BothOrNeither = (d: { m1Name?: string | null; m1Major?: string | null }) =>
    !!d.m1Name === !!d.m1Major;
const m2BothOrNeither = (d: { m2Name?: string | null; m2Major?: string | null }) =>
    !!d.m2Name === !!d.m2Major;

export const insertTeamSchemaBase = createInsertSchema(teamAccounts, {
    teamName: (schema) => schema.min(3).max(50),
    leadName: (schema) => schema.min(2),
    leadMajor: (schema) => schema.min(2),
    institution: (schema) => schema.min(2),
    phoneNumber: (schema) => schema.min(5),
    lineId: (schema) => schema.min(2),
}).omit({
    id: true,
    currentStageId: true,
    createdAt: true,
});

export const insertTeamSchema = insertTeamSchemaBase
    .refine(m1BothOrNeither, { message: "m1Name and m1Major must both be provided or both omitted" })
    .refine(m2BothOrNeither, { message: "m2Name and m2Major must both be provided or both omitted" });

export const updateTeamSchema = insertTeamSchemaBase.partial()
    .refine(m1BothOrNeither, { message: "m1Name and m1Major must both be provided or both omitted" })
    .refine(m2BothOrNeither, { message: "m2Name and m2Major must both be provided or both omitted" });

export const paginationSchema = z.object({
    page:  z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const teamIdParamSchema = z.object({
    teamId: z.string().uuid(),
})

export const selectTeamSchema = createSelectSchema(teamAccounts);
export const publicTeamSchema = selectTeamSchema.omit({
    id: true,
    phoneNumber: true,
    lineId: true,
});
