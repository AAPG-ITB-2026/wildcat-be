import { type createDb } from "../../db/index.js";
import { eq, count } from "drizzle-orm";
import { teamAccounts } from "../../db/schema.js";
import { type InferSelectModel } from "drizzle-orm";

type Db = ReturnType<typeof createDb>;

export const createTeam = async (db: Db, teamData: any, userId: string) => {
    try {
        const [newTeam] = await db.insert(teamAccounts).values({
            id: userId,
            competitionId: teamData.competitionId,
            teamName: teamData.teamName,
            institution: teamData.institution,
            phoneNumber: teamData.phoneNumber,
            lineId: teamData.lineId,
            leadName: teamData.leadName,
            leadMajor: teamData.leadMajor,
            m1Name: teamData.m1Name ?? null,
            m1Major: teamData.m1Major ?? null,
            m2Name: teamData.m2Name ?? null,
            m2Major: teamData.m2Major ?? null,
        }).returning();

        return newTeam;
    } catch (error: any) {
        throw error;
    }
}

export const updateTeam = async (db: Db, updates: Partial<InferSelectModel<typeof teamAccounts>>, id: string) => {
    try {
        const [updatedTeam] = await db.update(teamAccounts)
            .set(updates)
            .where(eq(teamAccounts.id, id))
            .returning();

        return updatedTeam;
    } catch (error: any) {
        throw error
    }
}

export const getAllTeams = async (db: Db, page: number, limit: number) => {
    try {
        const offset = (page - 1) * limit;
        const [{ total }] = await db.select({ total: count() }).from(teamAccounts);
        const data = await db.select().from(teamAccounts).limit(limit).offset(offset);
        return { data, total: Number(total), page, limit };
    } catch (error: any) {
        throw error
    }
}

export const getTeamById = async (db: Db, teamId: string) => {
    try {
        const data = await db.select().from(teamAccounts).where(eq(teamAccounts.id, teamId)).limit(1)
        return data
    } catch (error: any) {
        throw error
    }
}
