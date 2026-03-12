# Performance Audit — wildcat-be

> Scope: backend code-visible performance review only
> Date: 2026-03-12
> Method: static analysis of request paths, database access patterns, storage calls, and response construction

---

## Review Boundaries

This document only includes issues that are directly visible in the code.

It does **not** claim:

- missing database indexes
- slow query plans
- real production latency numbers
- memory pressure observed at runtime

Those require measurement. This audit stays within the `analyze` step of the profiling workflow and identifies concrete scaling risks that are already present in implementation.

---

## Priority Summary

| Priority | Area | Visible Problem | Primary Cost |
|----------|------|-----------------|--------------|
| P1 | Admin documents | Full dataset load plus per-document signed URL fan-out | Storage I/O + response latency |
| P2 | Admin transactions list | Unpaginated full list plus signed URL generation for every row | Storage I/O + response latency |
| P3 | Admin submissions overview | Per-team submission aggregation causes N+1 database reads | Database round trips |
| P4 | General list endpoints | Several endpoints return entire tables with no pagination | Response size + linear growth |
| P5 | Admin export | Excel workbook is built and serialized fully in memory | Memory + CPU on request path |
| P6 | Logging | High-volume console logging on hot paths and large payloads | CPU + log I/O |

---

## P1 — Admin Documents Endpoint Fans Out Across Every Team and Document

**Endpoint:** `GET /api/admin/documents/teams`

**Evidence**

- Query loads all team administration rows: `src/modules/admin/admin.route.ts:1632`
- Response processing maps across every row in parallel: `src/modules/admin/admin.route.ts:1676`
- Each team triggers up to five signed URL calls: `src/modules/admin/admin.route.ts:1728`

**What the code does now**

1. Reads every team administration record with joins.
2. Iterates over all returned teams.
3. For each team, attempts signed URL generation for `leadKtm`, `m1Ktm`, `m2Ktm`, `twibbonProof`, and `posterProof`.
4. Waits for all of that work before returning one response.

**Why this is a performance problem**

The endpoint cost scales with both the number of teams and the number of stored documents. Even if the database query is acceptable, the request still performs remote storage work on the critical path for every document that exists.

At code level, this is effectively:

- `1` bulk database read
- `N` team transformations
- up to `5N` signed download URL requests

That makes this endpoint one of the highest-impact latency risks in the codebase.

**Concrete fix**

Choose one of these patterns:

1. Return document metadata only in the list endpoint, and generate signed URLs in a detail endpoint per team or per document.
2. Add pagination before any URL generation so each request handles a bounded subset of teams.
3. If signed URLs must stay in the list response, only generate them for documents explicitly requested by query parameters.

**Recommended implementation**

- Add pagination to `GET /documents/teams`.
- Return booleans or raw storage paths in the list response.
- Move signed URL generation to a dedicated preview/download endpoint.

**Validation after fix**

- Compare request duration before and after on the same dataset.
- Count how many storage signing calls happen per request.
- Confirm response time no longer grows linearly with total stored documents.

---

## P2 — Admin Transactions List Signs Every Proof URL for the Entire Result Set

**Endpoint:** `GET /api/admin/transactions`

**Evidence**

- Query fetches all manual transactions ordered by creation time: `src/modules/admin/admin.route.ts:1125`
- Response generation signs URLs for every returned row: `src/modules/admin/admin.route.ts:1146`

**What the code does now**

1. Loads all transactions that have `paymentProofUrl`.
2. Maps over the full result set.
3. Generates a signed download URL for each row.
4. Returns the entire enriched array.

**Why this is a performance problem**

This endpoint has two scaling costs at once:

- no pagination on the transaction list
- one storage signing operation per returned transaction

As transaction volume grows, the endpoint gets slower and more expensive even if the client only needs a first page or summary.

**Concrete fix**

1. Add `limit` and `offset` or cursor-based pagination.
2. Return proof availability metadata in the list response.
3. Generate the signed URL only in `GET /api/admin/transactions/:transaction_id`, where the request is already scoped to one record.

**Recommended implementation**

- Make the list endpoint paginated.
- Keep `paymentProofUrl` out of the list response or return only a flag such as `hasPaymentProof`.
- Preserve signed URL generation in the existing transaction preview/detail route.

**Validation after fix**

- Verify the list endpoint issues a bounded number of storage calls per request.
- Verify response size remains stable as the table grows.
- Compare p50/p95 route duration before and after pagination.

---

## P3 — Admin Submissions Overview Has a Clear N+1 Database Pattern

**Endpoint:** `GET /api/admin/submissions`

**Evidence**

- Loads all teams once: `src/modules/admin/admin.route.ts:2177`
- Then runs nested `Promise.all` over competitions and teams: `src/modules/admin/admin.route.ts:2224`, `src/modules/admin/admin.route.ts:2226`
- Per-team aggregation performs repeated reads inside `listAllSubmissions`: `src/modules/submissions/submission.service.ts:321`, `src/modules/submissions/submission.service.ts:327`, `src/modules/submissions/submission.service.ts:337`, `src/modules/submissions/submission.service.ts:340`

**What the code does now**

For each team in the result set, `listAllSubmissions` performs:

1. team lookup
2. stage requirements lookup
3. team submissions lookup

That means one overview request turns into many smaller database round trips.

**Why this is a performance problem**

The pattern is visibly N+1. The endpoint does not aggregate by stage or competition in bulk; instead it repeatedly asks the database for overlapping information.

At code level, the query count scales roughly as:

- `1` read for all teams
- `3 x team_count` additional reads during per-team aggregation

This is a direct, code-visible source of avoidable database latency.

**Concrete fix**

Refactor the endpoint to load shared data in bulk:

1. fetch all teams once
2. collect all current stage IDs
3. fetch all stage requirements for those stage IDs once
4. fetch all submissions for those team IDs and stage IDs once
5. build the response in memory using maps keyed by `teamId` and `stageId`

**Recommended implementation**

- Add a bulk-oriented repository method specifically for admin submissions overview.
- Do not reuse the participant-oriented per-team service for the admin aggregate view.

**Validation after fix**

- Count database queries triggered by one admin submissions request.
- Verify the count stays near constant as team count grows.
- Compare request duration on a dataset with multiple competitions and stages.

---

## P4 — Several List Endpoints Return Entire Datasets With No Pagination

**Evidence**

- Admin teams list fetches every team: `src/modules/admin/admin.route.ts:589`
- Admin announcements list fetches every announcement: `src/modules/admin/admin.route.ts:2330`
- Participant announcements list fetches all matching announcements: `src/modules/announcements/announcements.route.ts:33`

**What the code does now**

These endpoints return all matching rows and then perform grouping or transformation in application code.

**Why this is a performance problem**

Even when there is no obvious N+1 pattern, unbounded list endpoints still create linear growth in:

- query result size
- JSON serialization cost
- transfer size
- memory used while building the response

This is a lower-impact issue than P1 through P3, but it repeats across the API surface and compounds long-term scaling cost.

**Concrete fix**

Standardize list endpoint behavior:

1. add pagination parameters
2. cap maximum page size
3. move summary counts into separate aggregate fields or endpoints
4. sort explicitly and predictably to support stable paging

**Recommended implementation order**

1. `GET /api/admin/transactions`
2. `GET /api/admin/documents/teams`
3. `GET /api/admin/teams`
4. `GET /api/admin/announcements`
5. `GET /api/announcements`

**Validation after fix**

- Confirm response payload size is bounded.
- Confirm each endpoint can serve the first page without reading the entire table into the response.

---

## P5 — Export Route Builds the Entire Excel Workbook in Memory

**Endpoint:** `GET /api/admin/export/metrics-recap`

**Evidence**

- Multiple aggregate queries run up front: `src/modules/admin/export.route.ts:75`, `src/modules/admin/export.route.ts:94`, `src/modules/admin/export.route.ts:103`
- Workbook is created in memory: `src/modules/admin/export.route.ts:112`
- Final XLSX buffer is serialized before responding: `src/modules/admin/export.route.ts:263`

**What the code does now**

1. Loads all export data needed for all sheets.
2. Creates an in-memory ExcelJS workbook.
3. Adds rows sheet by sheet.
4. Calls `writeBuffer()` and returns the fully materialized file.

**Why this is a performance problem**

The endpoint is synchronous from the client perspective and does all CPU and memory work on the request path. As exported data grows, both workbook creation and final buffer serialization become more expensive.

This is especially important in a Workers-style environment where memory headroom is limited compared with a long-lived server process.

**Concrete fix**

1. Keep the export bounded to small administrative datasets if that matches product expectations.
2. If larger exports are expected, move export generation to an asynchronous job or pre-generated file workflow.
3. Consider CSV exports for large data slices where workbook formatting is not essential.

**Recommended implementation**

- Short term: keep route as-is but document expected scale and restrict usage.
- Medium term: move export generation off the synchronous request path.

**Validation after fix**

- Measure request duration and memory consumption on representative export sizes.
- Verify large exports no longer block a single request until full file serialization completes.

---

## P6 — Console Logging Is Excessive on Hot Paths

**Evidence**

- Global request logger logs every request: `src/middlewares/logger.ts:4`
- Payment flow logs heavily during normal execution: `src/modules/payment/payment.route.ts:21`, `src/modules/payment/payment.route.ts:259`
- Admin transaction preview logs many intermediate values and full objects: `src/modules/admin/admin.route.ts:1258`
- Admin documents endpoint logs throughout processing: `src/modules/admin/admin.route.ts:1618`

**What the code does now**

The codebase already has a request logger, but many routes also emit repeated `console.log` and `console.error` calls, including full payloads and full serialized objects.

**Why this is a performance problem**

Console output is work on the request path. In this codebase the logging is not limited to failures; it is embedded throughout successful flows as well.

That adds overhead in three places:

- string construction
- JSON serialization for large objects
- runtime log shipping/storage

This is not the top bottleneck compared with P1 through P3, but the volume is high enough to be a real performance concern.

**Concrete fix**

1. Keep the one-line request logger.
2. Remove verbose per-step logs from hot paths.
3. Gate debug logging behind an environment flag.
4. Avoid logging full payloads, full response objects, and signed URLs.

**Recommended implementation**

- Use `logInfo` and `logError` for concise operational logs.
- Reserve detailed logs for local debugging only.

**Validation after fix**

- Compare log volume before and after.
- Compare route duration for hot paths with verbose logging removed.

---

## Recommended Fix Order

| Order | Work Item | Why First |
|-------|-----------|-----------|
| 1 | Refactor `GET /api/admin/documents/teams` | Highest visible fan-out and most expensive storage amplification |
| 2 | Paginate and de-enrich `GET /api/admin/transactions` | Same fan-out pattern on a list endpoint |
| 3 | Replace admin submissions N+1 path with bulk aggregation | High database round-trip reduction |
| 4 | Add pagination conventions to other list endpoints | Prevent linear response growth from spreading |
| 5 | Reduce production logging volume | Broad cross-cutting overhead reduction |
| 6 | Rework export generation strategy if large exports are expected | Important, but likely less frequent than admin list reads |

---

## Validation Checklist

After implementing fixes, validate with measurement rather than assumption.

1. Capture baseline request duration for the affected endpoints.
2. Count database queries triggered by each endpoint.
3. Count storage signing calls triggered by each endpoint.
4. Compare response payload sizes before and after pagination.
5. For exports, test small and large datasets separately.
6. Review log volume in the Workers runtime after cleanup.

---

## Final Note

This audit intentionally stops at code-visible issues. It should be followed by runtime profiling on the top three endpoints:

1. `GET /api/admin/documents/teams`
2. `GET /api/admin/transactions`
3. `GET /api/admin/submissions`

Those are the clearest candidates for baseline measurement, targeted optimization, and validation.