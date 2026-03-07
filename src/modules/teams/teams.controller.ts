import type { Context } from "hono";
import { insertTeamSchema, selectTeamSchema, updateTeamSchema } from "./teams.schema.js";
import { createTeam, getAllTeams, getTeamById, updateTeam } from "./teams.service.js";
import { createDb } from "../../db/index.js";
import type { Env, Variables } from "../../types/index.js";
import z from "zod";
import { listMyReleasedResults } from './teams-results.service.js';
import { TeamResultsError } from './teams-results.errors.js';
import {
    createDrizzleTeamAccountRepo,
    createDrizzleTeamResultsRepo,
} from './adapters/drizzle-team-results.adapter.js';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const handleCreateTeam = async (c: AppContext) => {
    try {
        const db = createDb(c.env);
        const data = await c.req.json()
        const parsedData = insertTeamSchema.parse(data)

        const insertedTeam = await createTeam(db, parsedData);

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

// TODO: clarif: why must leader names and major be in teams table? this causes some problems
export const handleUpdateTeam = async (c: AppContext) => {
    try{
        const db = createDb(c.env);
        const id = c.req.param('id')
        const data = await c.req.json()
        const parsedData = updateTeamSchema.parse(data)

        const updatedTeam = await updateTeam(db, parsedData, id)
        return c.json({success: true, data: updatedTeam}, 202)
        
    } catch (error: any){
        
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

export const handleGetMyResults = async (c: AppContext) => {
    try {
        const user = c.get('user');
        const teamId = user.id;
        const db = createDb(c.env);

        const data = await listMyReleasedResults(teamId, {
            accounts: createDrizzleTeamAccountRepo(db),
            results: createDrizzleTeamResultsRepo(db),
        });

        return c.json({ success: true, data }, 200);
    } catch (error) {
        if (error instanceof TeamResultsError) {
            return c.json(
                {
                    success: false,
                    error: {
                        code: error.code,
                        message: error.message,
                    },
                },
                403,
            );
        }

        console.error('[teams/my-results] Unexpected error:', error);
        return c.json(
            {
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'An unexpected error occurred',
                },
            },
            500,
        );
    }
}
