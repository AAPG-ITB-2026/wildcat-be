import { type createDb } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { teams, members } from "../../db/schema.js";
import { type InferSelectModel } from "drizzle-orm";

type Db = ReturnType<typeof createDb>;

// works as a transaction (teams - members) -> a team cannot be created without leader
// TODO: TAKE USERID FROM AUTH INSTEAD OF POST DATA
export const createTeam = async (db: Db, teamData: any) => {
    try {
        return await db.transaction(async (tx) => {
            const [newTeam] = await tx.insert(teams).values({
                userId: teamData.userId,   //TODO: ensure userId exists
                teamName: teamData.teamName,
                leaderName: "empty",
                leaderMajor: "empty", // placeholders
                university: teamData.university,
                category: teamData.category,
            }).returning(); // return inserted values

            // TODO: ADD USER ID CHECKS AND INSERTION
            await tx.insert(members).values({
                teamId: newTeam.id,
                fullName: teamData.leaderName,
                major: teamData.leaderMajor,
            });

            if (teamData.additionalMembers?.length) {
                await tx.insert(members).values(
                    teamData.additionalMembers.map((m: { fullName: string; major: string }) => ({
                        teamId: newTeam.id,
                        fullName: m.fullName,
                        major: m.major,
                    }))
                );
            }

            return newTeam;
        })
    } catch (error: any) {
        throw error;
    }
}

export const updateTeam = async (db: Db, updates: Partial<InferSelectModel<typeof teams>>, id: string) => {
    try {
        const [updatedTeam] = await db.update(teams)
            .set(updates)
            .where(eq(teams.id, id))
            .returning();

        return updatedTeam;
    } catch (error: any) {
        throw error
    }
}

export const getAllTeams = async (db: Db) => {
    try {
        const data = await db.select().from(teams)
        return data
    } catch (error: any) {
        throw error
    }
}

export const getTeamById = async (db: Db, teamId: string) => {
    try {
        const data = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
        return data
    } catch (error: any) {
        throw error
    }
}
