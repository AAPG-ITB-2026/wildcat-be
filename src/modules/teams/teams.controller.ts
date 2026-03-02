import type { Context } from "hono";
import { insertTeamSchema, selectTeamSchema, updateTeamSchema } from "./teams.schema.js";
import { createTeam, getAllTeams, getTeamById, updateTeam } from "./teams.service.js";
import { createDb } from "../../db/index.js";
import type { Env, Variables } from "../../types/index.js";
import z from "zod";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const handleCreateTeam = async (c: AppContext) => {
    try {
        const db = createDb(c.env);
        const userId = c.var.user.id;
        const data = await c.req.json()
        const parsedData = insertTeamSchema.parse(data)

        const insertedTeam = await createTeam(db, parsedData, userId);

        return c.json({ success: true, data: insertedTeam }, 201)
    } catch (error: any) {
        if (error.name === "ZodError") {
            return c.json({ success: false, error: "Validation failed", details: error.errors }, 400);
        }

        // unique constraint violation
        if (error.code === "23505") {
            const detail = error.detail;

            if (detail.includes("team_name")) {
                return c.json({ success: false, error: "Team name already exists" }, 409);
            }
        }

        console.error(error);
        return c.json({ success: false, error: "An unexpected error occurred" }, 500);
    }
}

export const handleUpdateTeam = async (c: AppContext) => {
    try{
        const db = createDb(c.env);
        const id = c.req.param('id')
        const data = await c.req.json()
        const parsedData = updateTeamSchema.parse(data)

        const updatedTeam = await updateTeam(db, parsedData, id)
        return c.json({success: true, data: updatedTeam}, 202)
        
    } catch (error: any){
        if (error.name === "ZodError") {
            return c.json({ success: false, error: "Validation failed", details: error.errors }, 400);
        }
        console.error(error);
        return c.json({ success: false, error: "An unexpected error occurred" }, 500);
    }
    
}

export const handleGetAllTeams = async (c: AppContext) => {
    try {
        const db = createDb(c.env);
        const data = await getAllTeams(db)
        const parsedData = z.array(selectTeamSchema).parse((data))
        return c.json({ data: parsedData })
    } catch (error: any) {
        console.error(error);
        return c.json({ success: false, error: "An unexpected error occurred" }, 500);
    }
}

export const handleGetTeamById = async (c: AppContext) => {
    try {
        const db = createDb(c.env);
        const teamId = c.req.param('id')
        const data = await getTeamById(db, teamId)

        const parsedData = z.array(selectTeamSchema).parse((data))
        return c.json({ data: parsedData[0] })
    } catch (error: any) {
        console.error(error);
        return c.json({ success: false, error: "An unexpected error occurred" }, 500);
    }
}
