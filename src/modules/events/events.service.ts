import { type createDb } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { events } from "../../db/schema.js";
import { type InferSelectModel } from "drizzle-orm";

type Db = ReturnType<typeof createDb>;

export const getEvents = async (db: Db) => {
    try {
        const data = await db.select().from(events).where(eq(events.isPublished, true))
        return data
    } catch (error: any) {
        throw error
    }
}

export const joinEvent = async (db: Db) => {
    // try {
    //     const data = await db.select().from(events)
    // } catch(error: any) {
    //     throw error
    // }
}
