import type { Context } from "hono";
import { selectEventSchema } from "./events.schema.js";
import { getEvents } from "./events.service.js";
import { createDb } from "../../db/index.js";
import type { Env, Variables } from "../../types/index.js";
import z from "zod";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;


export const handleGetEvents = async (c: AppContext) => {
    try {
        const db = createDb(c.env);
        const data = await getEvents(db)

        const parsedData = z.array(selectEventSchema).parse((data))
        return c.json({ data: parsedData })
    } catch (error: any) {
        console.error(error);
        return c.json({ success: false, error: "An unexpected error occurred" }, 500);
    }
}
