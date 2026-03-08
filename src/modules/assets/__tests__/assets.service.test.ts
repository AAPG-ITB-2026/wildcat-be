import { describe, it, expect, vi } from 'vitest';

import {
    getGuidebookUrl,
    validateCompetitionId,
} from '../assets.service.js';
import { AssetError } from '../assets.errors.js';
import type { AssetServiceDeps } from '../assets.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

/**
 * Builds a mock `AssetServiceDeps` where `db` is a chainable drizzle mock.
 * `resolvedRows` is the array returned by the final `.limit()` call.
 */
function createMockDeps(resolvedRows: unknown[] = []): AssetServiceDeps {
    const limit = vi.fn().mockResolvedValue(resolvedRows);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    return { db: { select } as unknown as AssetServiceDeps['db'] };
}

// ---------------------------------------------------------------------------
// validateCompetitionId
// ---------------------------------------------------------------------------

describe('validateCompetitionId', () => {
    it('should accept a valid UUID v4', () => {
        expect(() => validateCompetitionId(VALID_UUID)).not.toThrow();
    });

    it('should reject an empty string', () => {
        expect(() => validateCompetitionId('')).toThrow(AssetError);
        try { validateCompetitionId(''); } catch (err) {
            expect((err as AssetError).code).toBe('INVALID_COMPETITION_ID');
        }
    });

    it('should reject a non-UUID string', () => {
        expect(() => validateCompetitionId('not-a-uuid')).toThrow(AssetError);
    });

    it('should reject a UUID missing segments', () => {
        expect(() => validateCompetitionId('550e8400-e29b-41d4-a716')).toThrow(AssetError);
    });
});

// ---------------------------------------------------------------------------
// getGuidebookUrl
// ---------------------------------------------------------------------------

describe('getGuidebookUrl', () => {
    it('should return guidebook data for a valid competition with a guidebook', async () => {
        const deps = createMockDeps([
            { id: VALID_UUID, name: 'Paper & Poster', guidebookUrl: 'https://r2.example.com/guidebook.pdf' },
        ]);

        const result = await getGuidebookUrl(VALID_UUID, deps);

        expect(result).toEqual({
            competitionId: VALID_UUID,
            competitionName: 'Paper & Poster',
            guidebookUrl: 'https://r2.example.com/guidebook.pdf',
        });
    });

    it('should throw INVALID_COMPETITION_ID for a bad UUID before touching DB', async () => {
        const deps = createMockDeps();

        await expect(getGuidebookUrl('bad-id', deps)).rejects.toThrow(AssetError);

        try { await getGuidebookUrl('bad-id', deps); } catch (err) {
            expect((err as AssetError).code).toBe('INVALID_COMPETITION_ID');
        }

        // DB should never be called
        expect(deps.db.select).not.toHaveBeenCalled();
    });

    it('should throw COMPETITION_NOT_FOUND when no row is returned', async () => {
        const deps = createMockDeps([]); // empty result

        await expect(getGuidebookUrl(VALID_UUID, deps)).rejects.toThrow(AssetError);

        try { await getGuidebookUrl(VALID_UUID, deps); } catch (err) {
            expect((err as AssetError).code).toBe('COMPETITION_NOT_FOUND');
        }
    });

    it('should throw GUIDEBOOK_NOT_AVAILABLE when guidebookUrl is null', async () => {
        const deps = createMockDeps([
            { id: VALID_UUID, name: 'BCC', guidebookUrl: null },
        ]);

        await expect(getGuidebookUrl(VALID_UUID, deps)).rejects.toThrow(AssetError);

        try { await getGuidebookUrl(VALID_UUID, deps); } catch (err) {
            expect((err as AssetError).code).toBe('GUIDEBOOK_NOT_AVAILABLE');
        }
    });

    it('should throw GUIDEBOOK_NOT_AVAILABLE when guidebookUrl is empty string', async () => {
        const deps = createMockDeps([
            { id: VALID_UUID, name: 'GnG', guidebookUrl: '' },
        ]);

        await expect(getGuidebookUrl(VALID_UUID, deps)).rejects.toThrow(AssetError);

        try { await getGuidebookUrl(VALID_UUID, deps); } catch (err) {
            expect((err as AssetError).code).toBe('GUIDEBOOK_NOT_AVAILABLE');
        }
    });
});
