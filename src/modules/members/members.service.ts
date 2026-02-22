import { db } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { teams, members } from "../../db/schema.js";
import { type InferSelectModel } from "drizzle-orm";


// TODO: handle errors for addMember
export const addMember = async (memberData: any, teamId: string) => {
    try {
        const [insertedMember] = await db.insert(members).values({
            teamId: teamId,
            userId: memberData.userId,
            fullName: memberData.fullName,
            major: memberData.major,
        }).returning()

        return insertedMember;
    } catch (error: any) {
        throw error
    }
}

export const updateMember = async (updates: Partial<InferSelectModel<typeof members>>, id: string) => {
    try {
        const [updatedMember] = await db.update(members)
            .set(updates)
            .where(eq(members.id, id))
            .returning();

        return updatedMember;
    } catch (error: any) {
        throw error
    }
}

export const getAllTeamMembers = async (teamId: string) => {
    try {
        const membersResult = await db.select().from(members).where(eq(members.teamId, teamId))
        return membersResult
    } catch (error: any) {

    }
}

export const getMemberById = async (id: string) => {
    try {
        const member = await db.select().from(members).where(eq(members.id, id)).limit(1)
        return member
    } catch (error: any) {

    }
}


