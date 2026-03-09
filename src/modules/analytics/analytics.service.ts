import { type createDb } from "../../db/index.js";
import { sql, count } from "drizzle-orm";
import { teamAccounts, eventRegistrationLog } from "../../db/schema.js";

type Db = ReturnType<typeof createDb>;

type DailyCount = {
    date: string;
    daily: number;
    cumulative: number;
};

const computeCumulative = (rows: { date: string; daily: number }[]): DailyCount[] => {
    let running = 0;
    return rows.map(row => {
        running += row.daily;
        return { ...row, cumulative: running };
    });
};

export const getCompetitionRegistrationsByDate = async (db: Db): Promise<DailyCount[]> => {
    const rows = await db
        .select({
            date: sql<string>`DATE(${teamAccounts.createdAt})`.as("date"),
            daily: count(),
        })
        .from(teamAccounts)
        .groupBy(sql`DATE(${teamAccounts.createdAt})`)
        .orderBy(sql`DATE(${teamAccounts.createdAt})`);

    return computeCumulative(rows.map(r => ({ date: r.date, daily: Number(r.daily) })));
};

export const getEventRegistrationsByDate = async (db: Db): Promise<DailyCount[]> => {
    const rows = await db
        .select({
            date: sql<string>`DATE(${eventRegistrationLog.createdAt})`.as("date"),
            daily: count(),
        })
        .from(eventRegistrationLog)
        .groupBy(sql`DATE(${eventRegistrationLog.createdAt})`)
        .orderBy(sql`DATE(${eventRegistrationLog.createdAt})`);

    return computeCumulative(rows.map(r => ({ date: r.date, daily: Number(r.daily) })));
};
