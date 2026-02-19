import type { Context } from "hono";
import { insertTeamSchema } from "./teams.schema.js";
import { createTeam } from "./teams.service.js";

export const handleCreateTeam = async (c: Context) => {
    const data = await c.req.json()
    const parsedData = insertTeamSchema.parse(data)

    const insertedTeam = await createTeam(parsedData);

    return c.json({success: true, data: insertedTeam}, 201)
}
