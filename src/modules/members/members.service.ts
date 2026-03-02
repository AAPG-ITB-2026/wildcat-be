import { type createDb } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { teamAccounts } from "../../db/schema.js";
import type { MemberSlot } from "./members.schema.js";

type Db = ReturnType<typeof createDb>;

type MemberData = { fullName: string; major: string };
type MemberRecord = { slot: 'lead' | 'm1' | 'm2'; fullName: string; major: string };

export const addMember = async (db: Db, memberData: MemberData, teamId: string) => {
    const [team] = await db.select().from(teamAccounts).where(eq(teamAccounts.id, teamId)).limit(1);
    if (!team) throw new Error('TEAM_NOT_FOUND');

    let slot: MemberSlot;
    let update: Record<string, string>;

    if (!team.m1Name && !team.m1Major) {
        slot = 'm1';
        update = { m1Name: memberData.fullName, m1Major: memberData.major };
    } else if (!team.m2Name && !team.m2Major) {
        slot = 'm2';
        update = { m2Name: memberData.fullName, m2Major: memberData.major };
    } else {
        throw new Error('MEMBER_LIMIT_REACHED');
    }

    await db.update(teamAccounts).set(update).where(eq(teamAccounts.id, teamId));

    return { slot, fullName: memberData.fullName, major: memberData.major };
}

export const updateMember = async (db: Db, updates: Partial<MemberData>, teamId: string, slot: MemberSlot) => {
    const update: Record<string, string> = {};
    if (updates.fullName !== undefined) update[`${slot}Name`] = updates.fullName;
    if (updates.major !== undefined) update[`${slot}Major`] = updates.major;

    const [updatedTeam] = await db.update(teamAccounts)
        .set(update)
        .where(eq(teamAccounts.id, teamId))
        .returning();

    return {
        slot,
        fullName: slot === 'm1' ? updatedTeam.m1Name! : updatedTeam.m2Name!,
        major: slot === 'm1' ? updatedTeam.m1Major! : updatedTeam.m2Major!,
    };
}

export const getAllTeamMembers = async (db: Db, teamId: string): Promise<MemberRecord[]> => {
    const [team] = await db.select().from(teamAccounts).where(eq(teamAccounts.id, teamId)).limit(1);
    if (!team) throw new Error('TEAM_NOT_FOUND');

    const members: MemberRecord[] = [
        { slot: 'lead', fullName: team.leadName, major: team.leadMajor },
    ];
    if (team.m1Name && team.m1Major) members.push({ slot: 'm1', fullName: team.m1Name, major: team.m1Major });
    if (team.m2Name && team.m2Major) members.push({ slot: 'm2', fullName: team.m2Name, major: team.m2Major });

    return members;
}

export const deleteMember = async (db: Db, teamId: string, slot: MemberSlot) => {
    const update = slot === 'm1'
        ? { m1Name: null, m1Major: null }
        : { m2Name: null, m2Major: null };

    await db.update(teamAccounts).set(update).where(eq(teamAccounts.id, teamId));

    return { slot, deleted: true };
}
