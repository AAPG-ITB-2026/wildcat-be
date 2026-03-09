import type { Context } from "hono";
import { getCompetitionRegistrationsByDate, getEventRegistrationsByDate } from "./analytics.service.js";
import { createDb } from "../../db/index.js";
import type { Env, Variables } from "../../types/index.js";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const handleGetRegistrationCurves = async (c: AppContext) => {
    try {
        const db = createDb(c.env);

        const [competition, sideEvents] = await Promise.all([
            getCompetitionRegistrationsByDate(db),
            getEventRegistrationsByDate(db),
        ]);

        return c.json({ success: true, data: { competition, sideEvents } });
    } catch (error: any) {
        console.error(error);
        return c.json({ success: false, error: "An unexpected error occurred" }, 500);
    }
};
