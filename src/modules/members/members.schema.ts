
import { z } from 'zod';

export const memberSlotSchema = z.enum(['m1', 'm2']);
export type MemberSlot = z.infer<typeof memberSlotSchema>;

export const insertMemberSchema = z.object({
    fullName: z.string().min(2),
    major: z.string().min(2),
});

export const updateMemberSchema = insertMemberSchema.partial();

// TODO: ensure frontend uses the slots data in the page correctly
export const selectMemberSchema = z.object({
    slot: z.enum(['lead', 'm1', 'm2']),
    fullName: z.string(),
    major: z.string(),
});
