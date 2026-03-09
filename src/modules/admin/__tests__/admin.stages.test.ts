import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLimit, mockInsertReturning, mockUpdateReturning, mockDeleteWhere } = vi.hoisted(
  () => ({
    mockLimit: vi.fn(),
    mockInsertReturning: vi.fn(),
    mockUpdateReturning: vi.fn(),
    mockDeleteWhere: vi.fn().mockResolvedValue(undefined),
  }),
);

vi.mock('../../../db/index.js', () => ({
  createDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mockLimit })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: mockInsertReturning })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: mockUpdateReturning })),
      })),
    })),
    delete: vi.fn(() => ({
      where: mockDeleteWhere,
    })),
  })),
}));

vi.mock('../../../middlewares/auth.js', () => ({
  committeeMiddleware: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
}));

vi.mock('../export.route.js', async () => {
  const { Hono } = await vi.importActual<typeof import('hono')>('hono');
  return { default: new Hono() };
});

import admin from '../admin.route.js';

const COMP_ID   = '550e8400-e29b-41d4-a716-111111111111';
const STAGE_ID  = '550e8400-e29b-41d4-a716-222222222222';
const STAGE_ID2 = '550e8400-e29b-41d4-a716-333333333333';

const START = '2026-06-01T00:00:00.000Z';
const END   = '2026-06-30T00:00:00.000Z';

const mockStage = {
  id: STAGE_ID,
  competitionId: COMP_ID,
  name: 'Preliminary',
  startDate: new Date(START),
  endDate: new Date(END),
};

const mockRequirement = {
  id: '44444444-4444-4444-4444-444444444444',
  stageId: STAGE_ID,
  documentName: 'Abstract',
  allowedExtensions: 'application/pdf',
  maxSizeMb: 10,
  isMandatory: true,
};

function postJSON(path: string, body: unknown) {
  return admin.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function putJSON(path: string, body: unknown) {
  return admin.request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteWhere.mockResolvedValue(undefined);
});

// =============================================================================
// POST /stages — Create a competition stage
// =============================================================================

describe('POST /stages — schema validation', () => {
  it('rejects a missing competitionId (400)', async () => {
    const res = await postJSON('/stages', { name: 'Preliminary', startDate: START, endDate: END });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('Invalid body');
  });

  it('rejects a non-UUID competitionId (400)', async () => {
    const res = await postJSON('/stages', { competitionId: 'not-a-uuid', name: 'Preliminary', startDate: START, endDate: END });
    expect(res.status).toBe(400);
  });

  it('rejects a missing name (400)', async () => {
    const res = await postJSON('/stages', { competitionId: COMP_ID, startDate: START, endDate: END });
    expect(res.status).toBe(400);
  });

  it('rejects an empty name (400)', async () => {
    const res = await postJSON('/stages', { competitionId: COMP_ID, name: '', startDate: START, endDate: END });
    expect(res.status).toBe(400);
  });

  it('rejects a missing startDate (400)', async () => {
    const res = await postJSON('/stages', { competitionId: COMP_ID, name: 'Preliminary', endDate: END });
    expect(res.status).toBe(400);
  });

  it('rejects a non-ISO startDate (400)', async () => {
    const res = await postJSON('/stages', { competitionId: COMP_ID, name: 'Preliminary', startDate: '01-06-2026', endDate: END });
    expect(res.status).toBe(400);
  });

  it('rejects a missing endDate (400)', async () => {
    const res = await postJSON('/stages', { competitionId: COMP_ID, name: 'Preliminary', startDate: START });
    expect(res.status).toBe(400);
  });

  it('rejects endDate equal to startDate (400)', async () => {
    const res = await postJSON('/stages', { competitionId: COMP_ID, name: 'Preliminary', startDate: START, endDate: START });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/endDate must be after startDate/i);
  });

  it('rejects endDate before startDate (400)', async () => {
    const res = await postJSON('/stages', {
      competitionId: COMP_ID,
      name: 'Preliminary',
      startDate: END,
      endDate: START,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/endDate must be after startDate/i);
  });
});

describe('POST /stages — business logic', () => {
  const validBody = { competitionId: COMP_ID, name: 'Preliminary', startDate: START, endDate: END };

  it('returns 404 when the competition does not exist', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await postJSON('/stages', validBody);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/competition not found/i);
  });

  it('returns 409 when a stage with the same name already exists (exact match)', async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: COMP_ID }])
      .mockResolvedValueOnce([{ id: STAGE_ID }]);

    const res = await postJSON('/stages', validBody);
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toMatch(/already exists/i);
  });

  it('returns 409 for duplicate name with different casing (case-insensitive check)', async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: COMP_ID }])
      .mockResolvedValueOnce([{ id: STAGE_ID }]);

    const res = await postJSON('/stages', { ...validBody, name: 'PRELIMINARY' });
    expect(res.status).toBe(409);
  });

  it('returns 201 with the created stage on success', async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: COMP_ID }])
      .mockResolvedValueOnce([]);
    mockInsertReturning.mockResolvedValueOnce([mockStage]);

    const res = await postJSON('/stages', validBody);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.stage.name).toBe('Preliminary');
    expect(body.stage.competitionId).toBe(COMP_ID);
  });
});

// =============================================================================
// PUT /stages/:stageId — Update a stage's name / dates
// =============================================================================

describe('PUT /stages/:stageId — param & schema validation', () => {
  it('rejects a non-UUID stageId param (400)', async () => {
    const res = await putJSON('/stages/not-a-uuid', { name: 'Final' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/stageId must be a valid UUID/i);
  });

  it('rejects an empty body (no fields provided) (400)', async () => {
    const res = await putJSON(`/stages/${STAGE_ID}`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/at least one field/i);
  });

  it('rejects an invalid startDate format (400)', async () => {
    const res = await putJSON(`/stages/${STAGE_ID}`, { startDate: 'June-1-2026' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid endDate format (400)', async () => {
    const res = await putJSON(`/stages/${STAGE_ID}`, { endDate: '30/06/2026' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /stages/:stageId — business logic', () => {
  it('returns 404 when stage does not exist', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await putJSON(`/stages/${STAGE_ID}`, { name: 'Final' });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/stage not found/i);
  });

  it('returns 400 when only endDate is updated but falls before existing startDate', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: STAGE_ID,
      competitionId: COMP_ID,
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-07-31T00:00:00.000Z'),
    }]);

    const res = await putJSON(`/stages/${STAGE_ID}`, { endDate: '2026-06-01T00:00:00.000Z' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/endDate must be after startDate/i);
  });

  it('returns 400 when both dates are updated but endDate <= startDate', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: STAGE_ID,
      competitionId: COMP_ID,
      startDate: new Date(START),
      endDate: new Date(END),
    }]);

    const res = await putJSON(`/stages/${STAGE_ID}`, {
      startDate: '2026-08-01T00:00:00.000Z',
      endDate:   '2026-07-01T00:00:00.000Z',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/endDate must be after startDate/i);
  });

  it('returns 409 when renaming to a name used by another stage in the same competition', async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: STAGE_ID, competitionId: COMP_ID, startDate: new Date(START), endDate: new Date(END) }])
      .mockResolvedValueOnce([{ id: STAGE_ID2 }]);

    const res = await putJSON(`/stages/${STAGE_ID}`, { name: 'Final' });
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toMatch(/already exists/i);
  });

  it('does NOT 409 when renaming a stage to its own current name', async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: STAGE_ID, competitionId: COMP_ID, startDate: new Date(START), endDate: new Date(END) }])
      .mockResolvedValueOnce([]);
    mockUpdateReturning.mockResolvedValueOnce([{ ...mockStage, name: 'Preliminary' }]);

    const res = await putJSON(`/stages/${STAGE_ID}`, { name: 'Preliminary' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('updates name only (200)', async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: STAGE_ID, competitionId: COMP_ID, startDate: new Date(START), endDate: new Date(END) }])
      .mockResolvedValueOnce([]);
    mockUpdateReturning.mockResolvedValueOnce([{ ...mockStage, name: 'Semi-Final' }]);

    const res = await putJSON(`/stages/${STAGE_ID}`, { name: 'Semi-Final' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.stage.name).toBe('Semi-Final');
  });

  it('updates endDate only — falls back to existing startDate for validation (200)', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: STAGE_ID,
      competitionId: COMP_ID,
      startDate: new Date(START),
      endDate:   new Date(END),
    }]);
    const newEnd = '2026-09-30T00:00:00.000Z';
    mockUpdateReturning.mockResolvedValueOnce([{ ...mockStage, endDate: new Date(newEnd) }]);

    const res = await putJSON(`/stages/${STAGE_ID}`, { endDate: newEnd });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('updates all three fields at once (200)', async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: STAGE_ID, competitionId: COMP_ID, startDate: new Date(START), endDate: new Date(END) }])
      .mockResolvedValueOnce([]);
    const newStart = '2026-07-01T00:00:00.000Z';
    const newEnd   = '2026-08-31T00:00:00.000Z';
    mockUpdateReturning.mockResolvedValueOnce([{ ...mockStage, name: 'Final', startDate: new Date(newStart), endDate: new Date(newEnd) }]);

    const res = await putJSON(`/stages/${STAGE_ID}`, { name: 'Final', startDate: newStart, endDate: newEnd });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.stage.name).toBe('Final');
  });
});

// =============================================================================
// PUT /stages/:stageId/requirements — Replace all requirements for a stage
// =============================================================================

describe('PUT /stages/:stageId/requirements — param & schema validation', () => {
  it('rejects a non-UUID stageId param (400)', async () => {
    const res = await putJSON('/stages/not-a-uuid/requirements', {
      requirements: [{ documentName: 'Abstract', allowedExtensions: 'application/pdf', maxSizeMb: 10 }],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/stageId must be a valid UUID/i);
  });

  it('rejects an empty requirements array (400)', async () => {
    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, { requirements: [] });
    expect(res.status).toBe(400);
  });

  it('rejects a missing requirements array (400)', async () => {
    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {});
    expect(res.status).toBe(400);
  });

  it('rejects an empty documentName (400)', async () => {
    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: '', allowedExtensions: 'application/pdf', maxSizeMb: 10 }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects allowedExtensions that are plain extensions, not MIME types (e.g. "pdf") (400)', async () => {
    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: 'Abstract', allowedExtensions: 'pdf', maxSizeMb: 10 }],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.details).toBeDefined();
  });

  it('rejects allowedExtensions that are comma-separated extensions without type/ prefix (400)', async () => {
    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: 'Abstract', allowedExtensions: 'pdf,docx', maxSizeMb: 10 }],
    });
    expect(res.status).toBe(400);
  });

  it('accepts a single valid MIME type (e.g. "application/pdf")', async () => {
    mockLimit.mockResolvedValueOnce([{ id: STAGE_ID }]);
    mockInsertReturning.mockResolvedValueOnce([mockRequirement]);

    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: 'Abstract', allowedExtensions: 'application/pdf', maxSizeMb: 10 }],
    });
    expect(res.status).toBe(200);
  });

  it('accepts a comma-separated list of valid MIME types (e.g. "application/pdf,image/png")', async () => {
    mockLimit.mockResolvedValueOnce([{ id: STAGE_ID }]);
    mockInsertReturning.mockResolvedValueOnce([{ ...mockRequirement, allowedExtensions: 'application/pdf,image/png' }]);

    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: 'KTM', allowedExtensions: 'application/pdf,image/png', maxSizeMb: 5 }],
    });
    expect(res.status).toBe(200);
  });

  it('rejects maxSizeMb of 0 (400)', async () => {
    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: 'Abstract', allowedExtensions: 'application/pdf', maxSizeMb: 0 }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a negative maxSizeMb (400)', async () => {
    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: 'Abstract', allowedExtensions: 'application/pdf', maxSizeMb: -5 }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-integer maxSizeMb (400)', async () => {
    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: 'Abstract', allowedExtensions: 'application/pdf', maxSizeMb: 10.5 }],
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /stages/:stageId/requirements — business logic', () => {
  it('returns 404 when stage does not exist', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: 'Abstract', allowedExtensions: 'application/pdf', maxSizeMb: 10 }],
    });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/stage not found/i);
  });

  it('returns 200 and inserts a single requirement (200)', async () => {
    mockLimit.mockResolvedValueOnce([{ id: STAGE_ID }]);
    mockInsertReturning.mockResolvedValueOnce([mockRequirement]);

    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: 'Abstract', allowedExtensions: 'application/pdf', maxSizeMb: 10 }],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.stageId).toBe(STAGE_ID);
    expect(body.requirements).toHaveLength(1);
    expect(body.requirements[0].documentName).toBe('Abstract');
  });

  it('inserts multiple requirements and returns all of them (200)', async () => {
    const mockReq2 = { ...mockRequirement, id: '55555555-5555-5555-5555-555555555555', documentName: 'Full Paper' };
    mockLimit.mockResolvedValueOnce([{ id: STAGE_ID }]);
    mockInsertReturning.mockResolvedValueOnce([mockRequirement, mockReq2]);

    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [
        { documentName: 'Abstract',   allowedExtensions: 'application/pdf', maxSizeMb: 10 },
        { documentName: 'Full Paper', allowedExtensions: 'application/pdf', maxSizeMb: 25 },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.requirements).toHaveLength(2);
  });

  it('isMandatory defaults to true when omitted', async () => {
    const inserted = { ...mockRequirement, isMandatory: true };
    mockLimit.mockResolvedValueOnce([{ id: STAGE_ID }]);
    mockInsertReturning.mockResolvedValueOnce([inserted]);

    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      // isMandatory intentionally omitted
      requirements: [{ documentName: 'Abstract', allowedExtensions: 'application/pdf', maxSizeMb: 10 }],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.requirements[0].isMandatory).toBe(true);
  });

  it('calls delete before insert — full replacement semantics', async () => {
    mockLimit.mockResolvedValueOnce([{ id: STAGE_ID }]);
    mockInsertReturning.mockResolvedValueOnce([mockRequirement]);

    await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: 'Abstract', allowedExtensions: 'application/pdf', maxSizeMb: 10 }],
    });

    expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
    expect(mockInsertReturning).toHaveBeenCalledTimes(1);
  });

  it('accepts isMandatory: false explicitly', async () => {
    const inserted = { ...mockRequirement, isMandatory: false };
    mockLimit.mockResolvedValueOnce([{ id: STAGE_ID }]);
    mockInsertReturning.mockResolvedValueOnce([inserted]);

    const res = await putJSON(`/stages/${STAGE_ID}/requirements`, {
      requirements: [{ documentName: 'Optional Appendix', allowedExtensions: 'application/pdf', maxSizeMb: 5, isMandatory: false }],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.requirements[0].isMandatory).toBe(false);
  });
});
