import type { Context } from "hono";
import { insertMemberSchema, updateMemberSchema, selectMemberSchema, memberSlotSchema } from "./members.schema.js";
import { addMember, getAllTeamMembers, updateMember, deleteMember } from "./members.service.js"
import { createDb } from "../../db/index.js";
import type { Env, Variables } from "../../types/index.js";
import z from "zod";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const handleAddMember = async (c: AppContext) => {
    try {
        const db = createDb(c.env);
        const data = await c.req.json()
        const parsedData = insertMemberSchema.parse(data)
        const teamId = c.req.param('teamId')

        const insertedMember = await addMember(db, parsedData, teamId)
        return c.json({ success: true, data: insertedMember }, 201)
    } catch (error: any) {
        if (error.name === 'ZodError') {
            return c.json({ success: false, error: 'Validation failed', details: error.errors }, 400);
        }
        if (error.message === 'MEMBER_LIMIT_REACHED') {
            return c.json({ success: false, error: 'Team already has the maximum number of members' }, 409);
        }
        if (error.message === 'TEAM_NOT_FOUND') {
            return c.json({ success: false, error: 'Team not found' }, 404);
        }
        console.error(error);
        return c.json({ success: false, error: 'An unexpected error occurred' }, 500);
    }
}

export const handleUpdateMember = async (c: AppContext) => {
    try {
        const db = createDb(c.env);
        const teamId = c.req.param('teamId')
        const slot = memberSlotSchema.parse(c.req.param('slot'))
        const data = await c.req.json()
        const parsedData = updateMemberSchema.parse(data)

        const updatedMember = await updateMember(db, parsedData, teamId, slot)
        return c.json({ success: true, data: updatedMember }, 202)
    } catch (error: any) {
        if (error.name === 'ZodError') {
            return c.json({ success: false, error: 'Validation failed', details: error.errors }, 400);
        }
        console.error(error);
        return c.json({ success: false, error: 'An unexpected error occurred' }, 500);
    }
}

export const handleGetAllTeamMembers = async (c: AppContext) => {
    try {
        const db = createDb(c.env);
        const teamId = c.req.param('teamId')

        const data = await getAllTeamMembers(db, teamId)
        const parsedData = z.array(selectMemberSchema).parse(data)
        return c.json({ data: parsedData })
    } catch (error: any) {
        if (error.message === 'TEAM_NOT_FOUND') {
            return c.json({ success: false, error: 'Team not found' }, 404);
        }
        console.error(error);
        return c.json({ success: false, error: 'An unexpected error occurred' }, 500);
    }
}

export const handleDeleteMember = async (c: AppContext) => {
    try {
        const db = createDb(c.env);
        const teamId = c.req.param('teamId')
        const slot = memberSlotSchema.parse(c.req.param('slot'))

        const data = await deleteMember(db, teamId, slot)
        return c.json({ success: true, data })
    } catch (error: any) {
        if (error.name === 'ZodError') {
            return c.json({ success: false, error: 'Invalid slot — must be m1 or m2' }, 400);
        }
        if (error.message === 'TEAM_NOT_FOUND') {
            return c.json({ success: false, error: 'Team not found' }, 404);
        }
        console.error(error);
        return c.json({ success: false, error: 'An unexpected error occurred' }, 500);
    }
}
