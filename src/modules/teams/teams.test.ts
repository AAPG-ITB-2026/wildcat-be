import { describe, expect, it } from 'vitest';
import { insertTeamSchema } from './teams.schema.js';

describe('teams.schema', () => {
    it('should reject empty payload for team creation', () => {
        const result = insertTeamSchema.safeParse({});

        expect(result.success).toBe(false);
    });
});
