import { type createDb } from "../../db/index.js";
import { eq, count } from "drizzle-orm";
import { teams, members } from "../../db/schema.js";
import { type InferSelectModel } from "drizzle-orm";

type Db = ReturnType<typeof createDb>;

// TODO: handle errors for addMember
export const addMember = async (db: Db, memberData: any, teamId: string) => {
    try {
        
        // TODO: decide between this or parsing db trigger error message instead
        const [{ count: memberCount }] = await db.select({ count: count() })
            .from(members).where(eq(members.teamId, teamId));
        if (memberCount >= 3) {
            throw new Error('MEMBER_LIMIT_REACHED');
        }

        const [insertedMember] = await db.insert(members).values({
            teamId: teamId,
            fullName: memberData.fullName,
            major: memberData.major,
        }).returning()

        return insertedMember;
    } catch (error: any) {
        throw error
    }
}


export const updateMember = async (db: Db, updates: Partial<InferSelectModel<typeof members>>, id: string) => {
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


export const getAllTeamMembers = async (db: Db, teamId: string) => {
    try {
        const membersResult = await db.select().from(members).where(eq(members.teamId, teamId))
        return membersResult
    } catch (error: any) {

    }
}


export const getMemberById = async (db: Db, id: string) => {
    try {
        const member = await db.select().from(members).where(eq(members.id, id)).limit(1)
        return member
    } catch (error: any) {

    }
}

export const deleteMember = async (db: Db, id: string) => {
    try {
        const [deletedMember] = await db.delete(members).where(eq(members.id, id)).returning();
        return deletedMember
    } catch (error: any){
        throw error
    }
}
