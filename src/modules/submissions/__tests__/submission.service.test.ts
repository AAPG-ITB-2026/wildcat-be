import { describe, it, expect, vi } from 'vitest';

import {
    requestPresignedUrl,
    saveSubmission,
    validateFileExtension,
    buildSubmissionPath,
    sanitizeFileName,
} from '../submission.service.js';
import { SubmissionError } from '../submission.errors.js';
import type { SubmissionServiceDeps } from '../submission.types.js';

function createMockDeps(overrides?: Partial<SubmissionServiceDeps>): SubmissionServiceDeps {
    return {
        storage: {
            createSignedUploadUrl: vi.fn().mockResolvedValue({
                data: { signedUrl: 'https://r2.example.com/signed-url', path: 'test-path' },
                error: null,
            }),
            listFiles: vi.fn().mockResolvedValue({
                data: [{ name: 'file.pdf' }],
                error: null,
            }),
            headFile: vi.fn().mockResolvedValue({
                data: { contentType: 'application/pdf', contentLength: 12345 },
                error: null,
            }),
            getPublicUrl: vi.fn().mockImplementation((path: string) => `https://cdn.example.com/${path}`),
        },
        gatekeeping: {
            checkTeamEligibility: vi.fn().mockResolvedValue({ eligible: true }),
        },
        submissions: {
            findRequirementWithStage: vi.fn().mockResolvedValue({
                id: 'req-1',
                stageId: 'stage-1',
                documentName: 'Paper Submission',
                allowedExtensions: 'pdf,docx',
                maxSizeMb: 10,
            }),
            upsert: vi.fn().mockResolvedValue({
                id: 'sub-1',
                teamId: 'team-1',
                requirementId: 'req-1',
                fileUrl: 'https://cdn.example.com/file.pdf',
                isValid: false,
                submittedAt: new Date(),
            }),
        },
        teams: {
            findById: vi.fn().mockResolvedValue({ id: 'team-1', currentStageId: 'stage-1' }),
        },
        ...overrides,
    };
}

describe('sanitizeFileName', () => {
    it('should lowercase the file name', () => {
        expect(sanitizeFileName('MyFile.PDF')).toBe('myfile.pdf');
    });

    it('should replace spaces with hyphens', () => {
        expect(sanitizeFileName('my file name.pdf')).toBe('my-file-name.pdf');
    });

    it('should strip special characters', () => {
        expect(sanitizeFileName('file@#$%.pdf')).toBe('file.pdf');
    });

    it('should collapse multiple consecutive dots', () => {
        expect(sanitizeFileName('file..name..pdf')).toBe('file.name.pdf');
    });
});

describe('buildSubmissionPath', () => {
    it('should produce a path in the format: submissions/{teamId}/{reqId}/{timestamp}_{fileName}', () => {
        const path = buildSubmissionPath('team-1', 'req-1', 'Paper.pdf');
        expect(path).toMatch(/^submissions\/team-1\/req-1\/\d+_paper\.pdf$/);
    });
});

describe('validateFileExtension', () => {
    it('should pass for an allowed extension', () => {
        expect(() => validateFileExtension('paper.pdf', 'pdf,docx')).not.toThrow();
    });

    it('should throw for a disallowed extension', () => {
        expect(() => validateFileExtension('virus.exe', 'pdf,docx')).toThrow(SubmissionError);
    });

    it('should handle extensions with leading dots in allowedExtensions', () => {
        expect(() => validateFileExtension('paper.pdf', '.pdf,.docx')).not.toThrow();
    });

    it('should be case-insensitive', () => {
        expect(() => validateFileExtension('Paper.PDF', 'pdf')).not.toThrow();
    });

    it('should throw if filename has no extension', () => {
        expect(() => validateFileExtension('noext', 'pdf')).toThrowError(
            new SubmissionError('INVALID_REQUIREMENT', 'Filename must have an extension'),
        );
    });
});

describe('SubmissionError', () => {
    it('should carry both code and message', () => {
        const err = new SubmissionError('NOT_VERIFIED', 'Not verified');
        expect(err.code).toBe('NOT_VERIFIED');
        expect(err.message).toBe('Not verified');
        expect(err.name).toBe('SubmissionError');
    });

    it('should be an instance of Error', () => {
        const err = new SubmissionError('TEAM_NOT_FOUND', 'missing');
        expect(err).toBeInstanceOf(Error);
    });
});

describe('requestPresignedUrl', () => {
    const input = { filename: 'paper.pdf', requirement_id: 'req-1' };
    const teamId = 'team-1';

    it('should return a signed URL for a valid team and input', async () => {
        const deps = createMockDeps();
        const result = await requestPresignedUrl(teamId, input, deps);

        expect(result.signedUrl).toBeDefined();
        expect(result.path).toBeDefined();
        expect(deps.storage.createSignedUploadUrl).toHaveBeenCalledTimes(1);
        expect(deps.storage.createSignedUploadUrl).toHaveBeenCalledWith(
            expect.stringMatching(/^submissions\/team-1\/req-1\/\d+_paper\.pdf$/),
            {},
        );
    });

    it('should throw INVALID_REQUIREMENT when team has no current stage', async () => {
        const deps = createMockDeps({
            teams: { findById: vi.fn().mockResolvedValue({ id: 'team-1', currentStageId: null }) },
        });

        await expect(requestPresignedUrl(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await requestPresignedUrl(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('INVALID_REQUIREMENT');
            expect((err as SubmissionError).message).toBe(
                'Team has not been assigned to a competition stage yet',
            );
        }
    });

    it('should throw TEAM_NOT_FOUND when team does not exist', async () => {
        const deps = createMockDeps({
            teams: { findById: vi.fn().mockResolvedValue(null) },
        });

        await expect(requestPresignedUrl(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await requestPresignedUrl(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('TEAM_NOT_FOUND');
        }
    });

    it('should throw NOT_VERIFIED when administration is not verified', async () => {
        const deps = createMockDeps({
            gatekeeping: {
                checkTeamEligibility: vi.fn().mockResolvedValue({
                    eligible: false,
                    reason: 'Complete administration and payment first.',
                }),
            },
        });

        await expect(requestPresignedUrl(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await requestPresignedUrl(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('NOT_VERIFIED');
        }
    });

    it('should throw INVALID_REQUIREMENT when requirement does not exist', async () => {
        const deps = createMockDeps({
            submissions: {
                findRequirementWithStage: vi.fn().mockResolvedValue(null),
                upsert: vi.fn(),
            },
        });

        await expect(requestPresignedUrl(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await requestPresignedUrl(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('INVALID_REQUIREMENT');
        }
    });

    it('should throw INVALID_REQUIREMENT when requirement belongs to a different stage', async () => {
        const deps = createMockDeps({
            submissions: {
                findRequirementWithStage: vi.fn().mockResolvedValue({
                    id: 'req-1',
                    stageId: 'different-stage',
                    documentName: 'Paper',
                    allowedExtensions: 'pdf',
                    maxSizeMb: 10,
                }),
                upsert: vi.fn(),
            },
        });

        await expect(requestPresignedUrl(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await requestPresignedUrl(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('INVALID_REQUIREMENT');
        }
    });

    it('should throw INVALID_REQUIREMENT when file extension is not allowed', async () => {
        const deps = createMockDeps();
        const badInput = { filename: 'virus.exe', requirement_id: 'req-1' };

        await expect(requestPresignedUrl(teamId, badInput, deps)).rejects.toThrow(SubmissionError);

        try {
            await requestPresignedUrl(teamId, badInput, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('INVALID_REQUIREMENT');
        }
    });

    it('should throw SIGNED_URL_FAILED when storage returns an error', async () => {
        const deps = createMockDeps({
            storage: {
                createSignedUploadUrl: vi.fn().mockResolvedValue({
                    data: null,
                    error: new Error('R2 connection failed'),
                }),
                listFiles: vi.fn(),
                headFile: vi.fn(),
                getPublicUrl: vi.fn(),
            },
        });

        await expect(requestPresignedUrl(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await requestPresignedUrl(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('SIGNED_URL_FAILED');
        }
    });
});

describe('saveSubmission', () => {
    const input = {
        file_url: 'https://cdn.example.com/submissions/team-1/req-1/123_paper.pdf',
        requirement_id: 'req-1',
    };
    const teamId = 'team-1';

    it('should return a submission record for valid input', async () => {
        const deps = createMockDeps();
        const result = await saveSubmission(teamId, input, deps);

        expect(result.id).toBeDefined();
        expect(result.teamId).toBe('team-1');
        expect(result.requirementId).toBe('req-1');
        expect(result.fileUrl).toBeDefined();
        expect(deps.storage.headFile).toHaveBeenCalledWith('submissions/team-1/req-1/123_paper.pdf');
    });

    it('should throw INVALID_REQUIREMENT when team has no current stage', async () => {
        const deps = createMockDeps({
            teams: { findById: vi.fn().mockResolvedValue({ id: 'team-1', currentStageId: null }) },
        });

        await expect(saveSubmission(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await saveSubmission(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('INVALID_REQUIREMENT');
            expect((err as SubmissionError).message).toBe(
                'Team has not been assigned to a competition stage yet',
            );
        }
    });

    it('should throw INVALID_REQUIREMENT when file URL does not belong to submissions bucket', async () => {
        const deps = createMockDeps();
        const badInput = {
            ...input,
            file_url: 'https://evil.com/malware.exe',
        };

        await expect(saveSubmission(teamId, badInput, deps)).rejects.toThrow(SubmissionError);

        try {
            await saveSubmission(teamId, badInput, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('INVALID_REQUIREMENT');
            expect((err as SubmissionError).message).toBe(
                'file_url must point to the submissions storage bucket',
            );
        }
    });

    it('should throw INVALID_REQUIREMENT when uploaded file exceeds maximum size', async () => {
        const deps = createMockDeps({
            submissions: {
                findRequirementWithStage: vi.fn().mockResolvedValue({
                    id: 'req-1',
                    stageId: 'stage-1',
                    documentName: 'Paper',
                    allowedExtensions: 'pdf',
                    maxSizeMb: 1,
                }),
                upsert: vi.fn(),
            },
            storage: {
                createSignedUploadUrl: vi.fn(),
                listFiles: vi.fn(),
                headFile: vi.fn().mockResolvedValue({
                    data: { contentType: 'application/pdf', contentLength: 2 * 1024 * 1024 },
                    error: null,
                }),
                getPublicUrl: vi.fn().mockImplementation((path: string) => `https://cdn.example.com/${path}`),
            },
        });

        await expect(saveSubmission(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await saveSubmission(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('INVALID_REQUIREMENT');
            expect((err as SubmissionError).message).toBe('Uploaded file exceeds maximum size of 1 MB');
        }
    });

    it('should throw INVALID_REQUIREMENT when uploaded file extension is not allowed in save flow', async () => {
        const deps = createMockDeps({
            submissions: {
                findRequirementWithStage: vi.fn().mockResolvedValue({
                    id: 'req-1',
                    stageId: 'stage-1',
                    documentName: 'Paper',
                    allowedExtensions: 'pdf',
                    maxSizeMb: 10,
                }),
                upsert: vi.fn(),
            },
        });

        const badInput = {
            ...input,
            file_url: 'https://cdn.example.com/submissions/team-1/req-1/123_payload.exe',
        };

        await expect(saveSubmission(teamId, badInput, deps)).rejects.toThrow(SubmissionError);

        try {
            await saveSubmission(teamId, badInput, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('INVALID_REQUIREMENT');
            expect((err as SubmissionError).message).toContain("File extension '.exe' is not allowed");
        }

        expect(deps.storage.headFile).not.toHaveBeenCalled();
    });

    it('should throw TEAM_NOT_FOUND when team does not exist', async () => {
        const deps = createMockDeps({
            teams: { findById: vi.fn().mockResolvedValue(null) },
        });

        await expect(saveSubmission(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await saveSubmission(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('TEAM_NOT_FOUND');
        }
    });

    it('should throw NOT_VERIFIED when team is not eligible', async () => {
        const deps = createMockDeps({
            gatekeeping: {
                checkTeamEligibility: vi.fn().mockResolvedValue({
                    eligible: false,
                    reason: 'Complete administration and payment first.',
                }),
            },
        });

        await expect(saveSubmission(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await saveSubmission(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('NOT_VERIFIED');
        }
    });

    it('should throw INVALID_REQUIREMENT when requirement does not exist', async () => {
        const deps = createMockDeps({
            submissions: {
                findRequirementWithStage: vi.fn().mockResolvedValue(null),
                upsert: vi.fn(),
            },
        });

        await expect(saveSubmission(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await saveSubmission(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('INVALID_REQUIREMENT');
        }
    });

    it('should throw INVALID_REQUIREMENT when requirement belongs to a different stage', async () => {
        const deps = createMockDeps({
            submissions: {
                findRequirementWithStage: vi.fn().mockResolvedValue({
                    id: 'req-1',
                    stageId: 'wrong-stage',
                    documentName: 'Paper',
                    allowedExtensions: 'pdf',
                    maxSizeMb: 10,
                }),
                upsert: vi.fn(),
            },
        });

        await expect(saveSubmission(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await saveSubmission(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('INVALID_REQUIREMENT');
        }
    });

    it('should throw DB_WRITE_FAILED when upsert fails', async () => {
        const deps = createMockDeps({
            submissions: {
                findRequirementWithStage: vi.fn().mockResolvedValue({
                    id: 'req-1',
                    stageId: 'stage-1',
                    documentName: 'Paper',
                    allowedExtensions: 'pdf',
                    maxSizeMb: 10,
                }),
                upsert: vi.fn().mockRejectedValue(
                    new SubmissionError('DB_WRITE_FAILED', 'Upsert returned no rows'),
                ),
            },
        });

        await expect(saveSubmission(teamId, input, deps)).rejects.toThrow(SubmissionError);

        try {
            await saveSubmission(teamId, input, deps);
        } catch (err) {
            expect((err as SubmissionError).code).toBe('DB_WRITE_FAILED');
        }
    });
});
