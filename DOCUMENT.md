# Wildcat BE — API Documentation

**Base URL (production):** `https://api.wildcat2026.com`

---

## Authentication

Most routes require a valid Supabase JWT passed as a Bearer token:

```
Authorization: Bearer <access_token>
```

| Middleware | Applied to | Description |
|---|---|---|
| `authMiddleware` | `/api/landing/*`, `/api/admin/*`, `/api/upload/*`, `/api/submissions/*`, `/api/announcements/*` | Verifies the JWT via Supabase JWKS (ES256). Sets `user` on context. |
| `adminMiddleware` | `/api/admin/*` | Requires the user to be an active committee member. |
| `committeeMiddleware(opts)` | Individual admin routes | Further restricts by `role` and/or `division`. |

---

## Common Error Shape

All error responses follow this shape:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { "field": ["validation error"] }  // optional, validation errors only
  }
}
```

| Status | Meaning |
|---|---|
| `400` | Validation error / bad request |
| `401` | Missing or invalid JWT |
| `403` | Valid JWT but insufficient permissions |
| `404` | Resource not found |
| `500` | Internal server error |
| `502` | Upstream dependency (e.g. R2 storage) failed |

---

## Health

### `GET /health`
Returns server liveness status. No auth required.

**Response `200`**
```json
{ "status": "ok", "timestamp": "2026-03-08T00:00:00.000Z" }
```

---

## Landing (`/api/landing`)

Auth: **Required** on all routes.

---

### `GET /api/landing`
Returns static landing page content. No auth required.

**Query params**
| Name | Type | Default | Description |
|---|---|---|---|
| `lang` | `"en"` \| `"id"` | `"id"` | Response language |

**Response `200`**
```json
{
  "meta": { "lang": "ID", "generatedAt": "2026-03-08T00:00:00.000Z" },
  "hero": { "title": "...", "description": "..." },
  "announcement": null
}
```

---

### `GET /api/landing/check-registration`
Check whether the authenticated user has already registered a team.

**Response `200`**
```json
{
  "registered": true,
  "teamId": "uuid",
  "competitionId": "uuid",
  "isCompleted": true
}
```

| Field | Description |
|---|---|
| `registered` | `false` → redirect to Step 1 form |
| `isCompleted` | `false` → redirect to Step 2 form; `true` → redirect to dashboard |

---

### `GET /api/landing/team`
Get full team profile for the authenticated user.

**Response `200`**
```json
{
  "id": "uuid",
  "competitionId": "uuid",
  "teamName": "Team Alpha",
  "leadName": "John Doe",
  "institution": "ITB",
  "leadMajor": "Teknik Geologi",
  "phoneNumber": "081234567890",
  "lineId": "johndoe",
  "m1Name": "Jane Doe",
  "m1Major": "Teknik Geofisika",
  "m2Name": null,
  "m2Major": null
}
```

**Response `404`**
```json
{ "error": "Team not found" }
```

---

### `POST /api/landing/register/step1`
Create a new team with minimal required fields.

**Body**
```json
{
  "competitionId": "uuid",
  "teamName": "Team Alpha",
  "leadName": "John Doe",
  "institution": "ITB",
  "leadMajor": "Teknik Geologi"
}
```

**Response `201`**
```json
{ "teamId": "uuid" }
```

---

### `PATCH /api/landing/register/step2`
Update the team with contact info and optional members. User ID from token is used as team ID.

**Body**
```json
{
  "phoneNumber": "081234567890",
  "lineId": "johndoe",
  "m1Name": "Jane Doe",
  "m1Major": "Teknik Geofisika",
  "m2Name": null,
  "m2Major": null
}
```

**Response `200`**
```json
{ "success": true }
```

---

### `POST /api/landing/register/complete`
Create or update a team with all fields at once (upsert).

**Body**
```json
{
  "competitionId": "uuid",
  "teamName": "Team Alpha",
  "leadName": "John Doe",
  "institution": "ITB",
  "leadMajor": "Teknik Geologi",
  "phoneNumber": "081234567890",
  "lineId": "johndoe",
  "m1Name": "Jane Doe",
  "m1Major": "Teknik Geofisika",
  "m2Name": null,
  "m2Major": null
}
```

**Response `201`** (created) or **`200`** (updated)
```json
{ "teamId": "uuid", "created": true }
```

---

## Announcements (`/api/announcements`)

Auth: **Required**.

---

### `GET /api/announcements`
Fetch announcements targeted at the authenticated team's competition or `"All"`.

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Important Notice",
      "content": "...",
      "targetAudience": "All",
      "attachmentUrl": "https://...",
      "createdAt": "2026-03-08T00:00:00.000Z"
    }
  ]
}
```

**Response `404`**
```json
{ "error": "Team profile not found" }
```

---

## Assets (`/api/assets`)

Auth: **Not required**.

---

### `GET /api/assets/guidebook/:competitionId`
Get the public guidebook URL for a competition.

**Params**
| Name | Type | Description |
|---|---|---|
| `competitionId` | `string` (UUID) | Competition ID |

**Response `200`**
```json
{
  "success": true,
  "data": { "url": "https://storage.wildcat2026.com/..." }
}
```

**Error codes**

| Code | Status | Description |
|---|---|---|
| `INVALID_COMPETITION_ID` | 400 | Not a valid UUID |
| `COMPETITION_NOT_FOUND` | 404 | Competition does not exist |
| `GUIDEBOOK_NOT_AVAILABLE` | 404 | No guidebook set for this competition |

---

## Upload (`/api/upload`)

Auth: **Required**. IDOR protection: `teamId` in body must match the authenticated user's ID.

---

### `POST /api/upload/sign`
Request a pre-signed S3 upload URL for an administration document.

**Body**
```json
{
  "teamId": "uuid",
  "documentType": "lead_ktm",
  "contentType": "application/pdf",
  "fileName": "ktm_john.pdf"
}
```

| Field | Allowed values |
|---|---|
| `documentType` | `lead_ktm`, `m1_ktm`, `m2_ktm`, `twibbon_proof`, `poster_proof` |
| `contentType` | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` |
| `fileName` | Must end in `.jpg`, `.jpeg`, `.png`, `.webp`, or `.pdf` |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "signedUrl": "https://...",
    "filePath": "teams/uuid/lead_ktm/ktm_john.pdf"
  }
}
```

**Error codes**

| Code | Status | Description |
|---|---|---|
| `TEAM_NOT_FOUND` | 404 | Team does not exist |
| `INVALID_CONTENT_TYPE` | 422 | Content type not allowed |
| `SIGNED_URL_FAILED` | 502 | R2 failed to generate URL |

---

### `POST /api/upload/confirm`
Confirm a completed upload and persist the file path to the database.

**Body**
```json
{
  "teamId": "uuid",
  "documentType": "lead_ktm",
  "filePath": "teams/uuid/lead_ktm/ktm_john.pdf"
}
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "teamId": "uuid",
    "documentType": "lead_ktm",
    "filePath": "teams/uuid/lead_ktm/ktm_john.pdf"
  }
}
```

**Error codes**

| Code | Status | Description |
|---|---|---|
| `TEAM_NOT_FOUND` | 404 | Team does not exist |
| `FILE_NOT_FOUND` | 404 | File path does not exist in R2 |
| `INVALID_FILE_PATH` | 400 | Path format is invalid |
| `DB_WRITE_FAILED` | 500 | Failed to persist to database |

---

## Submissions (`/api/submissions`)

Auth: **Required**. Team ID is always derived from the authenticated user's token.

---

### `POST /api/submissions/request-url`
Request a pre-signed upload URL for a stage submission file.

**Body**
```json
{
  "requirement_id": "uuid",
  "filename": "submission.pdf",
  "content_type": "application/pdf"
}
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "signedUrl": "https://...",
    "filePath": "submissions/uuid/..."
  }
}
```

**Error codes**

| Code | Status | Description |
|---|---|---|
| `TEAM_NOT_FOUND` | 404 | Authenticated user has no team |
| `NOT_VERIFIED` | 403 | Team's administration docs not yet verified |
| `STAGE_NOT_ASSIGNED` | 400 | Team has no active stage assigned |
| `REQUIREMENT_NOT_FOUND` | 400 | Requirement ID does not exist |
| `STAGE_MISMATCH` | 400 | Requirement belongs to a different stage |
| `INVALID_EXTENSION` | 400 | File extension not allowed |
| `INVALID_CONTENT_TYPE` | 422 | Content type not allowed |
| `SIGNED_URL_FAILED` | 502 | R2 failed to generate URL |

---

### `POST /api/submissions`
Save a completed submission after the file has been uploaded.

**Body**
```json
{
  "requirement_id": "uuid",
  "file_path": "submissions/uuid/..."
}
```

**Response `201`**
```json
{
  "success": true,
  "data": {
    "submissionId": "uuid",
    "teamId": "uuid",
    "requirementId": "uuid",
    "filePath": "submissions/uuid/..."
  }
}
```

**Error codes**

| Code | Status | Description |
|---|---|---|
| `TEAM_NOT_FOUND` | 404 | Authenticated user has no team |
| `NOT_VERIFIED` | 403 | Team's administration docs not yet verified |
| `STAGE_NOT_ASSIGNED` | 400 | Team has no active stage assigned |
| `REQUIREMENT_NOT_FOUND` | 400 | Requirement ID does not exist |
| `STAGE_MISMATCH` | 400 | Requirement belongs to a different stage |
| `INVALID_STORAGE_PATH` | 400 | File path format is invalid |
| `FILE_METADATA_UNAVAILABLE` | 400 | Could not read file metadata from R2 |
| `FILE_TOO_LARGE` | 400 | File exceeds maximum allowed size |
| `DB_WRITE_FAILED` | 500 | Failed to persist to database |

---

## Admin (`/api/admin`)

Auth: **Required** (JWT + active committee member). Additional role/division checks noted per route.

---

### `PATCH /api/admin/config`
Toggle a global feature flag.

**Body**
```json
{
  "key": "RELEASE_SCORES",
  "value": "true"
}
```

| Field | Allowed values |
|---|---|
| `key` | `RELEASE_SCORES`, `MAINTENANCE_MODE` |
| `value` | `"true"`, `"false"` |

**Response `200`**
```json
{ "success": true, "key": "RELEASE_SCORES", "value": "true" }
```

---

### `PUT /api/admin/content/:section`
Upsert a CMS content section (FAQs, Judges, Hero, etc.).

**Params**
| Name | Type | Description |
|---|---|---|
| `section` | `string` | Content section key |

**Body**
```json
{ "content": "{\"key\":\"value\"}" }
```
> Pass `JSON.stringify(yourData)` as the `content` value.

**Response `200`**
```json
{ "success": true, "section": "faqs", "updatedAt": "2026-03-08T00:00:00.000Z" }
```

---

### `POST /api/admin/announcements`
Create a broadcast announcement.

**Body**
```json
{
  "title": "Important Notice",
  "content": "Please check your email.",
  "targetAudience": "All",
  "attachmentUrl": "https://...",
  "scheduledFor": "2026-03-10T00:00:00.000Z"
}
```

| Field | Allowed values | Required |
|---|---|---|
| `targetAudience` | `All`, `Paper_Poster`, `BCC`, `GnG`, `HighSchool` | ✅ |
| `attachmentUrl` | Valid URL | ❌ |
| `scheduledFor` | ISO 8601 datetime | ❌ |

**Response `201`**
```json
{ "success": true, "announcement": { "id": "uuid", "title": "...", ... } }
```

---

### `POST /api/admin/verify`
Accept or reject a team's administration documents.

**Auth:** `Admin` or `Committee` role required.

**Body**
```json
{
  "teamId": "uuid",
  "action": "Verified",
  "rejectionNotes": "Missing signature"
}
```

| Field | Allowed values | Required |
|---|---|---|
| `action` | `Verified`, `Rejected` | ✅ |
| `rejectionNotes` | string | Required when `action` is `"Rejected"` |

**Response `200`**
```json
{
  "success": true,
  "verification": {
    "teamId": "uuid",
    "verificationStatus": "Verified",
    "verifiedBy": "committee-uuid",
    "rejectionNotes": null
  },
  "team": {
    "id": "uuid",
    "teamName": "Team Alpha",
    "institution": "ITB",
    "leadName": "John Doe",
    "competitionId": "uuid",
    "createdAt": "2026-03-08T00:00:00.000Z"
  }
}
```

**Response `404`**
```json
{ "error": "Team administration record not found" }
```

---

### `GET /api/admin/metrics/events`
Per-event registered & attended counts.

**Auth:** `Admin` role **or** `Event` division required.

**Response `200`**
```json
{
  "events": [
    { "id": "uuid", "name": "Opening Ceremony", "registeredCount": 120, "attendedCount": 98 }
  ],
  "grandTotals": { "registeredCount": 120, "attendedCount": 98 }
}
```

---

### `GET /api/admin/metrics/competitions`
Team count per competition.

**Auth:** `Admin` or `Committee` role required.

**Response `200`**
```json
{
  "competitions": [
    { "competitionId": "uuid", "competitionName": "GnG", "teamCount": 45 }
  ],
  "grandTotal": 45
}
```

---

### `GET /api/admin/transactions`
Paginated list of payment transactions for committee review.

**Query params**
| Name | Type | Default | Description |
|---|---|---|---|
| `limit` | `number` (1–100) | `20` | Page size |
| `offset` | `number` | `0` | Page offset |

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "transactionId": "uuid",
      "team": { "id": "uuid", "name": "Team Alpha", "institution": "ITB" },
      "orderId": "ORDER-123",
      "amount": "150000.00",
      "paymentType": "bank_transfer",
      "verificationStatus": "Pending",
      "verifiedBy": null,
      "rejectionNotes": null,
      "createdAt": "2026-03-08T00:00:00.000Z",
      "paymentProof": {
        "originalFileRef": "teams/uuid/payment.jpg",
        "objectKey": "teams/uuid/payment.jpg",
        "downloadUrl": "https://..."
      }
    }
  ]
}
```

---

### `GET /api/admin/teams/administration`
Paginated list of team administration document submissions for committee review.

**Query params**
| Name | Type | Default | Description |
|---|---|---|---|
| `limit` | `number` (1–100) | `20` | Page size |
| `offset` | `number` | `0` | Page offset |

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "team": { "id": "uuid", "name": "Team Alpha", "institution": "ITB" },
      "verificationStatus": "Pending",
      "verifiedBy": null,
      "rejectionNotes": null,
      "documents": {
        "leadKtm": { "originalFileRef": "...", "objectKey": "...", "downloadUrl": "https://..." },
        "twibbonProof": { "originalFileRef": "...", "objectKey": "...", "downloadUrl": "https://..." },
        "posterProof": { "originalFileRef": null, "objectKey": null, "downloadUrl": null }
      }
    }
  ]
}
```

---

### `GET /api/admin/stages/:stage_id/submissions`
Paginated list of stage submission files for committee review.

**Params**
| Name | Type | Description |
|---|---|---|
| `stage_id` | `string` (UUID) | Stage ID |

**Query params**
| Name | Type | Default | Description |
|---|---|---|---|
| `limit` | `number` (1–100) | `20` | Page size |
| `offset` | `number` | `0` | Page offset |

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "submissionId": "uuid",
      "team": { "id": "uuid", "name": "Team Alpha", "institution": "ITB" },
      "requirement": { "id": "uuid", "documentName": "Technical Paper" },
      "isValid": false,
      "verifiedBy": null,
      "submittedAt": "2026-03-08T00:00:00.000Z",
      "file": {
        "originalFileRef": "submissions/uuid/paper.pdf",
        "objectKey": "submissions/uuid/paper.pdf",
        "downloadUrl": "https://..."
      }
    }
  ]
}
```
