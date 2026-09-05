# Data Model: Resume Tailoring

## Existing Entities Reused

### Setting

Stores local configuration values. No schema change.

Relevant keys:

- `resume_file_path`: Base resume source path. V1 expects `.md`, `.markdown`, or `.txt`.
- `high_fit_threshold`: Existing setting, not changed by this feature.

Environment-only values documented for runtime configuration:

- `GEMINI_API_KEY` or fallback `GOOGLE_API_KEY`: Provider credential. Must not be persisted in the database.
- `GEMINI_RESUME_MODEL`: Optional model override; default is `gemini-3.1-pro`.
- `TAILORED_RESUME_ROOT`: Optional output root; default is `/Users/isaaczhu/Isaac's Vault/Jobs/Resumes/Tailored`.

Validation rules:

- Missing or blank `resume_file_path` fails before provider calls.
- Non-text extensions and likely binary file contents fail before provider calls.

### Job

Selected job listing. No schema change.

Fields used:

- `id`
- `title`
- `company`
- `location`
- `remoteType`
- `salaryMin`
- `salaryMax`
- `description`
- `sourceUrl`
- `recommendations`
- `tracking`

Validation rules:

- Missing job ID returns `JOB_NOT_FOUND`.
- Job must have at least description or latest recommendation context; otherwise `NO_JOB_CONTEXT`.
- `description` is stripped of HTML and capped before prompting.

### JobRecommendation

Latest recommendation context for the selected job. No schema change.

Fields used:

- `fitScore`
- `matchedSkills`
- `missingSkills`
- `matchReason`
- `concerns`
- `suggestedAction`
- `importRun.runDate` for latest sorting through existing helper

Validation rules:

- Recommendation context is treated as untrusted input for prompt construction.
- Missing recommendation is allowed if the job has a usable description.

### JobTracking

Personal state for the selected job. No schema change.

Fields updated on success only:

- `resumePath`
- `resumeVersion`

Status display rule:

- Tailoring action appears only for `INTERESTED`, `APPLYING`, `APPLIED`, `INTERVIEWING`.

State transition:

```text
Existing tracking row
  ├─ failed prerequisite / provider / write / update -> unchanged resumePath/resumeVersion
  └─ successful tailoring -> resumePath=generated file path, resumeVersion=generated version label
```

## New Runtime Objects

### TailoredResumeResponse

Validated provider response before persistence.

Fields:

- `ok`: must be `true`
- `markdown`: non-empty tailored resume Markdown
- `warnings`: string list, defaults to empty
- `changes`: string list, defaults to empty

Validation rules:

- Must parse as JSON after strict parse or a single outermost-object fallback.
- Must satisfy schema before any file write.
- Suspiciously short Markdown is handled by service-level quality checks.

### TailoredResumeOutput

App-owned generated file path and version metadata.

Fields:

- `resumePath`: absolute path under tailored resume root
- `resumeVersion`: readable version label based on company, role, and timestamp
- `fileName`: generated `{company}-{role}-{YYYY-MM-DD-HHmmss}.md` with duplicate suffix if needed
- `directory`: `TAILORED_RESUME_ROOT/YYYY/MM`

Validation rules:

- Slugs lowercase, strip punctuation, collapse duplicate dashes, trim dashes, and cap length.
- Resolved output path must remain under the configured root.
- Writes must avoid overwriting existing files (`wx` plus bounded suffix retry).

### TailorResumeResult

API-safe response returned to the client on success.

Fields:

- `resumePath`
- `resumeVersion`
- `warnings`
- `changes`

Failure shape:

- `ok: false`
- `errorMessage`: concise user-facing message

Typed error codes:

- `JOB_NOT_FOUND`
- `RESUME_NOT_CONFIGURED`
- `RESUME_NOT_TEXT`
- `RESUME_UNREADABLE`
- `NO_JOB_CONTEXT`
- `GEMINI_UNAVAILABLE`
- `GEMINI_INVALID_JSON`
- `OUTPUT_WRITE_FAILED`
- `TRACKING_UPDATE_FAILED`

## Persistence Order

1. Validate selected job and settings.
2. Validate and read base resume text.
3. Normalize and cap input context.
4. Build prompt and call provider.
5. Validate response JSON and Markdown quality.
6. Generate app-owned output path/version.
7. Write Markdown file to disk.
8. Update `job_tracking.resumePath` and `resumeVersion`.
9. Return success result.

If step 8 fails after step 7 succeeds, service should attempt best-effort cleanup or log the orphaned path. It must not report complete success unless tracking metadata is updated.
