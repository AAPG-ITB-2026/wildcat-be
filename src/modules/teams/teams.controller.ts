import type { Context } from "hono";
import { insertTeamSchema, selectTeamSchema } from "./teams.schema.js";
import { createTeam, getAllTeams, getTeamById } from "./teams.service.js";
import z from "zod";

export const handleCreateTeam = async (c: Context) => {
    try {
        const data = await c.req.json()
        const parsedData = insertTeamSchema.parse(data)

        const insertedTeam = await createTeam(parsedData);

        return c.json({ success: true, data: insertedTeam }, 201)
    } catch (error: any) {
        if (error.name === "ZodError") {
            return c.json({ success: false, error: "Validation failed", details: error.errors }, 400);
        }

        // unique contraints violation
        if (error.code === "23505") {
            const detail = error.detail;

            // TODO: test these includes keys
            if (detail.includes("team_name")) {
                return c.json({ success: false, error: "Team name already exists" }, 409);
            }

            // TODO: clarify if an account can register to multiple comp
            if (detail.includes("members_pkey") || detail.includes("user_id")) {
                return c.json({ success: false, error: "User is already a member of a team" }, 409);
            }
        }

        // unexpected error
        console.error(error);
        return c.json({ success: false, error: "An unexpected error occurred" }, 500);
    }
}

export const handleGetAllTeams = async (c: Context) => {
    try {
        const data = await getAllTeams()
        const parsedData = z.array(selectTeamSchema).parse((data))
        return c.json({ data: parsedData })
    } catch (error: any) {
        console.error(error);
        return c.json({ success: false, error: "An unexpected error occurred" }, 500);
    }
}

export const handleGetTeamById = async (c: Context) => {
    try {
        const teamId = c.req.param('id')
        const data = await getTeamById(teamId)

        const parsedData = z.array(selectTeamSchema).parse((data))
        return c.json({ data: parsedData[0] })
    } catch (error: any) {
        console.error(error);
        return c.json({ success: false, error: "An unexpected error occurred" }, 500);
    }
}
