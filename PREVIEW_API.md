# Preview/Download Document API

## Overview

Added unified **GET Document** endpoints that allow users to retrieve signed download URLs for their uploaded documents. The frontend can use these URLs for both **preview** (embedded in an iframe/viewer) and **download** (direct file download).

## Upload Module Endpoint

### `GET /upload/:teamId/:documentType`

Retrieves a signed download URL for a specific document.

**Authentication**: Required (user must own the team)

**Path Parameters**:
- `teamId` (UUID): The team ID
- `documentType` (string): One of: `lead_ktm`, `m1_ktm`, `m2_ktm`, `twibbon_proof`, `poster_proof`

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "signedUrl": "https://...",
    "contentType": "application/pdf"
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid parameters
- `403 Forbidden`: User doesn't own the team
- `404 Not Found`: Document doesn't exist for this team/type
- `502 Bad Gateway`: Failed to generate signed URL

## Submissions Module Endpoint

### `GET /submissions/:requirementId`

Retrieves a signed download URL for a submitted requirement document.

**Authentication**: Required (user must own the team)

**Path Parameters**:
- `requirementId` (UUID): The requirement ID

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "signedUrl": "https://...",
    "contentType": "application/pdf",
    "documentName": "Project Report"
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid parameters or invalid stage
- `403 Forbidden`: Team is not verified
- `404 Not Found`: Submission doesn't exist or team not found

## Implementation Details

### Upload Module Changes

1. **Schema** (`upload.schema.ts`):
   - Added `getDocumentSchema` for input validation

2. **Types** (`upload.types.ts`):
   - Added `GetDocumentResult` interface
   - Extended `AdministrationRepository` with `getField()` method

3. **Service** (`upload.service.ts`):
   - Added `getDocument()` function that:
     - Verifies the team exists
     - Retrieves the stored file path from the administration record
     - Gets file metadata for content-type
     - Generates a signed download URL (1 hour expiry)

4. **Routes** (`upload.route.ts`):
   - Added `GET /:teamId/:documentType` endpoint with IDOR protection

5. **Adapter** (`adapters/drizzle-administration.adapter.ts`):
   - Implemented `getField()` method to fetch file paths by document type

### Submissions Module Changes

1. **Schema** (`submission.schema.ts`):
   - Added `getSubmissionSchema` for input validation

2. **Types** (`submission.types.ts`):
   - Added `GetSubmissionResult` interface
   - Extended `SubmissionRepository` with `getSubmissionByRequirement()` method

3. **Errors** (`submission.errors.ts`):
   - Added `SUBMISSION_NOT_FOUND` and `FILE_NOT_FOUND` error codes

4. **Service** (`submission.service.ts`):
   - Added `getSubmission()` function that:
     - Verifies the team exists and is eligible
     - Validates stage assignment and requirement
     - Retrieves the submission record
     - Gets file metadata for content-type
     - Generates a signed download URL (1 hour expiry)

5. **Routes** (`submission.route.ts`):
   - Added `GET /:requirementId` endpoint with auth checks

6. **Adapter** (`adapters/drizzle-submission.adapter.ts`):
   - Implemented `getSubmissionByRequirement()` method

### Features

- ✅ **IDOR Protection**: Only team members can access their own documents
- ✅ **Signed URLs**: Secure, time-limited URLs (1 hour expiry)
- ✅ **Content-Type Support**: Returns the file's MIME type for proper handling
- ✅ **Error Handling**: Consistent error responses matching existing patterns
- ✅ **Submissions Validation**: Additional checks for team eligibility and stage assignment

## Frontend Usage

### Upload Module - Preview
```javascript
const response = await fetch(`/upload/${teamId}/${documentType}`);
const { data } = await response.json();

// Embed in iframe for preview
document.getElementById('preview').src = data.signedUrl;
```

### Upload Module - Download
```javascript
const response = await fetch(`/upload/${teamId}/${documentType}`);
const { data } = await response.json();

// Trigger download
const a = document.createElement('a');
a.href = data.signedUrl;
a.download = true;
a.click();
```

### Submissions Module - Preview
```javascript
const response = await fetch(`/submissions/${requirementId}`);
const { data } = await response.json();

// Embed in iframe for preview
document.getElementById('preview').src = data.signedUrl;
```

### Submissions Module - Download
```javascript
const response = await fetch(`/submissions/${requirementId}`);
const { data } = await response.json();

// Trigger download
const a = document.createElement('a');
a.href = data.signedUrl;
a.download = `${data.documentName}`;
a.click();
```

## Security Notes

1. **Authentication Required**: All requests must include valid auth token
2. **IDOR Protection**: 
   - Upload module: User can only access documents from their own team
   - Submissions module: User can only access submissions from their own team
3. **Submissions Extra Checks**: 
   - Team must be verified
   - Team must have a current stage assigned
   - Requirement must belong to the team's current stage
4. **Time-Limited URLs**: Signed URLs expire after 1 hour
5. **No Public Access**: Files cannot be accessed without proper authentication
