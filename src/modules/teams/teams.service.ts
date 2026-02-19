import { db } from "../../db/index.js";
import { teams, members } from "../../db/schema.js";

// works as a transaction (teams - members) -> a team cannot be created without leader
export const createTeam = async (teamData: any) => {
    return await db.transaction(async (tx) => {
        const [newTeam] = await tx.insert(teams).values({
            userId: teamData.userId,   //TODO: ensure userId means leader's auth id
            teamName: teamData.teamName,
            leaderName: teamData.leaderName,
            university: teamData.university,
            leaderMajor: teamData.leaderMajor,
            category: teamData.category,
        }).returning(); // return inserted values

        await tx.insert(members).values({
            teamId: newTeam.id,
            fullName: teamData.leaderName,
            major: teamData.leaderMajor,
        })

        return newTeam;
    })
}
