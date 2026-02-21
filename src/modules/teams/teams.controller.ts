import type { Context } from "hono";
import { insertTeamSchema } from "./teams.schema.js";
import { createTeam } from "./teams.service.js";

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
