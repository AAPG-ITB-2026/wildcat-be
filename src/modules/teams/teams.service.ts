import { db } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { teams, members } from "../../db/schema.js";

// works as a transaction (teams - members) -> a team cannot be created without leader
// TODO: TAKE USERID FROM AUTH INSTEAD OF POST DATA
export const createTeam = async (teamData: any) => {
    try {
        return await db.transaction(async (tx) => {
            const [newTeam] = await tx.insert(teams).values({
                userId: teamData.userId,   //TODO: ensure userId exists
                teamName: teamData.teamName,
                leaderName: teamData.leaderName,
                university: teamData.university,
                leaderMajor: teamData.leaderMajor,
                category: teamData.category,
            }).returning(); // return inserted values

            // TODO: ADD USER ID CHECKS AND INSERTION
            await tx.insert(members).values({
                userId: teamData.userId,
                teamId: newTeam.id,
                fullName: teamData.leaderName,
                major: teamData.leaderMajor,
            })

            return newTeam;
        })
    } catch (error: any) {
        throw error;
    }
}

export const getAllTeams = async () => {
    try {
        const data = await db.select().from(teams)
        return data
    } catch (error: any) {
        throw error
    }
}

export const getTeamById = async (teamId: string) => {
    try {
        const data = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
        return data
    } catch (error: any) {
        throw error
    }
}
