import type { Context } from "hono";
import { insertMemberSchema, updateMemberSchema, selectMemberSchema  } from "./members.schema.js";
import { addMember, getAllTeamMembers, getMemberById, updateMember, deleteMember } from "./members.service.js"
import { createDb } from "../../db/index.js";
import type { Env, Variables } from "../../types/index.js";
import z from "zod";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const handleAddMember = async (c: AppContext) => {
    try {
        const db = createDb(c.env);
        const data = await c.req.json()
        const parsedData = insertMemberSchema.parse(data)
        const teamId = c.req.param('id')

        const insertedMember = await addMember(db, parsedData, teamId)
        return c.json({ success: true, data: insertedMember }, 201)
    } catch (error: any) {
        if (error.name === 'ZodError') {
            return c.json({ success: false, error: 'Validation failed', details: error.errors }, 400);
        }
        if (error.message === 'MEMBER_LIMIT_REACHED') {
            return c.json({ success: false, error: 'Team already has the maximum number of members' }, 409);
        }
        console.error(error);
        return c.json({ success: false, error: 'An unexpected error occurred' }, 500);
    }

}


// id alone should be enough
// However, since a member's info has universal information besides teamId, there might be a better way to handle member data
// Because an id only identifies a membership within one team, what if the user is assigned to multiple teams? the major and full name won't change anyway
export const handleUpdateMember = async (c: AppContext) => {
    try{
        const db = createDb(c.env);
        const id = c.req.param('id')
        const data = await c.req.json()
        const parsedData = updateMemberSchema.parse(data)

        const updatedMember = await updateMember(db, parsedData, id)
        return c.json({success: true, data: updatedMember}, 202)
        
    } catch (error: any){
        
    }
}

export const handleGetAllTeamMembers = async (c: AppContext) => {
    try {
        const db = createDb(c.env);
        const teamId = c.req.param('id')

        const data = await getAllTeamMembers(db, teamId)
        const parsedData = z.array(selectMemberSchema).parse((data))
        return c.json({ data: parsedData })
    } catch (error: any) {

    }
}

export const handleGetMember = async (c: Context) => {
    try {
        const db = createDb(c.env);
        const id = c.req.param('id')

        const data = await getMemberById(db, id)
        const parsedData = z.array(selectMemberSchema).parse((data))
        return c.json({ data: parsedData[0] })
    } catch (error: any) {

    }
}

// TODO: add auth checks through middleware
export const handleDeleteMember = async (c: Context) => {
    try {
        const db = createDb(c.env);
        const id = c.req.param('id')

        const data = await deleteMember(db, id)
        const parsedData = z.array(selectMemberSchema).parse((data))
        return c.json({ data: parsedData[0] })
    } catch (error: any) {

    }
}
