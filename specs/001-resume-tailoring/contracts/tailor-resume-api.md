# Contract: Tailor Resume API

## Endpoint

```text
POST /api/jobs/{id}/tailor-resume
```

Runtime:

- Node.js server route only.
- Force dynamic execution.
- No request body required for V1.

## Path Parameters

- `id` string: Job ID to tailor a resume for.

## Success Response

HTTP `200`

```json
{
  "ok": true,
  "resumePath": "/Users/isaaczhu/Isaac's Vault/Jobs/Resumes/Tailored/2026/06/notion-data-engineer-2026-06-11-143015.md",
  "resumeVersion": "notion-data-engineer-2026-06-11-143015",
  "warnings": [
    "The job asks for dbt; base resume evidence is lighter there."
  ],
  "changes": [
    "Moved data platform experience higher.",
    "Emphasized Spark, SQL, orchestration, and analytics pipeline evidence."
  ]
}
```

Response rules:

- `resumePath` is app-generated, absolute, and under `TAILORED_RESUME_ROOT`.
- `resumeVersion` is app-generated from job/company/timestamp, not provider-supplied.
- `warnings` and `changes` default to empty arrays.
- Success means both file write and `job_tracking` update completed.

## Error Response

```json
{
  "ok": false,
  "errorMessage": "Resume tailoring currently requires a Markdown or plain-text resume. Use the .md resume path, not a PDF."
}
```

## Status Mapping

- `404`: `JOB_NOT_FOUND`
- `400`: `RESUME_NOT_CONFIGURED`
- `400`: `RESUME_NOT_TEXT`
- `400`: `RESUME_UNREADABLE`
- `400`: `NO_JOB_CONTEXT`
- `502`: `GEMINI_UNAVAILABLE`
- `502`: `GEMINI_INVALID_JSON`
- `500`: `OUTPUT_WRITE_FAILED`
- `500`: `TRACKING_UPDATE_FAILED`
- `500`: unknown error

The route must map statuses by typed error code, not substring matching error messages.

## User-Facing Error Messages

- `Configure a Markdown base resume path in Settings before tailoring.`
- `The configured resume file could not be read.`
- `Resume tailoring currently requires a Markdown or plain-text resume. Use the .md resume path, not a PDF.`
- `This job needs a description or recommendation context before tailoring.`
- `Gemini is not configured. Add GEMINI_API_KEY to the JobBoard environment.`
- `Gemini could not generate a valid tailored resume. Try again or check logs.`
- `The tailored resume was generated but could not be saved.`

## Client Contract

The existing `TrackingForm` calls this endpoint when `Tailor resume` is clicked.

Client behavior:

1. Set inline loading state and clear prior error.
2. POST to `/api/jobs/${jobId}/tailor-resume`.
3. If `ok: true`, update only `resumePath` and `resumeVersion` in both `form` and `lastSaved`.
4. Render warnings and changes below the button.
5. If `ok: false` or non-JSON/network failure, render inline error and do not mutate resume fields.
6. Do not call the normal `save()` handler after success; the route already persists resume fields.

## Provider Contract

The provider adapter must return parsed and validated data equivalent to:

```json
{
  "ok": true,
  "markdown": "# Isaac Zhu\n...",
  "warnings": [],
  "changes": []
}
```

Provider output rules:

- Strict JSON only.
- No Markdown fence or surrounding prose.
- The app may attempt one outermost-object fallback for harmless wrapper text.
- The app rejects malformed JSON, missing `ok: true`, empty Markdown, or invalid field types.
- Provider output never includes filesystem paths or database mutation instructions.
