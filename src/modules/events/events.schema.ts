import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { events } from "../../db/schema.js";
import z from "zod";

export const selectEventSchema = createSelectSchema(events);
