# Personal Job Tracker Technical Spec

## Architecture

The application is a local-only web app backed by Postgres.

```text
Daily job automation
        |
        | JSON file or API payload
        v
Import handler
        |
        v
Postgres database
        |
        v
Local web app
```

## Independent ATS collector contract (post-V1)

The optional TypeScript CLI under `scripts/collector/` runs outside the request-serving app. Versioned JSON configuration defines company boards, request limits and deterministic screening rules. The normalized posting keeps stable provider/board/job identity, source dates with explicit evidence semantics, and annual USD salary only where supported. Output includes one merged `ats_collector_rules_v1` import payload, source diagnostics, a normalized snapshot and an independent first/last-observation ledger. Additional per-job `collector` metadata is preserved by the existing importer's raw-payload handling; no Prisma changes are required.

Collection writes to `.collector-output/` by default, never the current daily automation's vault directory. A separate command takes an explicit loopback `/api/import-jobs` endpoint; there is no implicit production URL, automatic POST, or activated schedule. Only a nonempty batch with all configured sources successfully fetched is eligible for that command. Successful target+payload hashes suppress duplicate POSTs, and ambiguous requests retain pending state for reconciliation. Today continues receiving a single combined batch. Source failures must not mark jobs missing, and missing feed membership must not be represented as confirmed closure. See `specs/003-ats-collector/` for detailed behavior and tests.

## Recommended Stack

- Next.js.
- TypeScript.
- Tailwind CSS.
- Prisma ORM.
- Postgres.
- No authentication in V1.
- Local `.env` configuration.

## Runtime Assumptions

- The app runs locally.
- Database runs locally or through a local Docker Postgres container.
- The daily automation produces structured JSON.
- The app supports both JSON file import and API import.
- The base resume is referenced by local file path only. Resume tailoring V1 expects Markdown/plain text and rejects PDF/Office/image/binary inputs before generation.

## Environment Variables

```bash
DATABASE_URL="postgresql://jobboard:***@localhost:5432/jobboard"
RESUME_FILE_PATH="/Users/isaaczhu/Isaac's Vault/Jobs/Resumes/Resume-Isaac Zhu.md"
HIGH_FIT_THRESHOLD="80"
GEMINI_API_KEY="your_gemini_api_key_here"
# Optional fallback/override values:
GOOGLE_API_KEY="your_google_api_key_here"
GEMINI_RESUME_MODEL="gemini-3.1-pro"
TAILORED_RESUME_ROOT="/Users/isaaczhu/Isaac's Vault/Jobs/Resumes/Tailored"
```

`RESUME_FILE_PATH` and `HIGH_FIT_THRESHOLD` are **seed values only**. On first run, the app writes them into the `settings` table if those rows do not already exist. After that, the `settings` table is the source of truth; changing the env vars has no effect. The Settings UI edits the DB rows.

`GEMINI_API_KEY`, optional `GOOGLE_API_KEY`, `GEMINI_RESUME_MODEL`, and `TAILORED_RESUME_ROOT` are runtime environment values for the post-V1 resume tailoring feature. API keys must stay in `.env`; they are not database settings.

## Core Domain Model

Separate job listing data from personal tracking state.

This avoids resetting status or notes when the same job appears in multiple daily recommendation runs.

### Tables

#### import_runs

Stores one daily automation import.

Fields:

- `id`
- `run_date` — calendar date the automation ran, not a timestamp
- `source_name`
- `status`
- `raw_payload`
- `error_message` — populated when `status = FAILED`, so failures are debuggable from the Import view without server logs
- `notes` — optional free-text label for the run
- `created_at`

#### jobs

Stores normalized job listing records.

Fields:

- `id`
- `title`
- `company`
- `location`
- `remote_type`
- `salary_min` — integer, **USD annual** (V1 assumption)
- `salary_max` — integer, **USD annual** (V1 assumption)
- `description` — raw HTML from the source listing; **sanitized on render** (see Description Handling)
- `source_url`
- `normalized_source_url`
- `date_posted`
- `dedupe_key`
- `fallback_dedupe_key`
- `created_at` — row creation time; doubles as "first seen" since rows are inserted on first import
- `last_imported_at` — updated on every import that matches this job; used by import flow and import history
- `updated_at` — touched on any field edit (Prisma `@updatedAt`)

#### job_recommendations

Stores recommendation metadata for a job in a specific import run.

Fields:

- `id`
- `job_id`
- `import_run_id`
- `fit_score`
- `priority`
- `matched_skills`
- `missing_skills`
- `match_reason`
- `concerns`
- `suggested_action`
- `raw_recommendation`
- `created_at`

#### job_tracking

Stores Isaac's personal state for a job. Exactly one row per job — created in the same transaction as the `jobs` row.

Fields:

- `id`
- `job_id`
- `status`
- `status_changed_at` — set whenever `status` changes; lets the UI show "Interested for 5 days"
- `notes`
- `next_action`
- `next_action_date`
- `applied_at`
- `resume_path`
- `resume_version`
- `created_at`
- `updated_at`

`priority` is intentionally **not** on this table — see Priority Handling below.

#### Priority Handling

`priority` lives **only** on `job_recommendations` — it reflects what the automation said about the job in a given run. Isaac does not edit it directly. UI surfaces the priority from the **latest recommendation** for a job.

Incoming priority values are normalized case-insensitively before storage. For example, `"high"`, `"HIGH"`, and `"High"` all map to `Priority.HIGH`. Unknown priority values are rejected by validation.

#### Description Handling

`jobs.description` is stored as raw HTML (most job sites emit HTML). It MUST be sanitized at render time using DOMPurify or an equivalent allowlist sanitizer before being injected into the DOM. Never render description with `dangerouslySetInnerHTML` without first passing through the sanitizer. If the source emits plain text, store it as-is — sanitizing plain text is a no-op.

#### settings

Stores local app settings.

Fields:

- `id`
- `key`
- `value`
- `created_at`
- `updated_at`

Expected V1 settings:

- `resume_file_path`
- `high_fit_threshold`

## Enums

### JobStatus

```text
NEW
INTERESTED
APPLYING
APPLIED
INTERVIEWING
OFFER
REJECTED
PASSED
ARCHIVED
```

### ImportRunStatus

```text
PENDING
SUCCESS
FAILED
```

### Priority

```text
LOW
MEDIUM
HIGH
URGENT
```

Priority should remain nullable because incoming recommendations may not always provide it.

## Prisma Schema Draft

```prisma
model ImportRun {
  id           String          @id @default(cuid())
  runDate      DateTime        @db.Date
  sourceName   String?
  status       ImportRunStatus @default(PENDING)
  rawPayload   Json
  errorMessage String?
  notes        String?
  createdAt    DateTime        @default(now())

  recommendations JobRecommendation[]

  @@index([runDate, createdAt])
}

model Job {
  id                  String   @id @default(cuid())
  title               String
  company             String
  location            String?
  remoteType          String?
  salaryMin           Int?
  salaryMax           Int?
  description         String?
  sourceUrl           String?
  normalizedSourceUrl String?
  datePosted          DateTime?
  dedupeKey           String   @unique
  fallbackDedupeKey   String
  createdAt           DateTime @default(now())
  lastImportedAt      DateTime @default(now())
  updatedAt           DateTime @updatedAt

  recommendations JobRecommendation[]
  tracking        JobTracking?

  @@index([normalizedSourceUrl])
  @@index([fallbackDedupeKey])
  @@index([company, title])
}

model JobRecommendation {
  id                String   @id @default(cuid())
  jobId             String
  importRunId       String
  fitScore          Int?
  priority          Priority?
  matchedSkills     String[]
  missingSkills     String[]
  matchReason       String?
  concerns          String?
  suggestedAction   String?
  rawRecommendation Json
  createdAt         DateTime @default(now())

  job       Job       @relation(fields: [jobId], references: [id])
  importRun ImportRun @relation(fields: [importRunId], references: [id])

  @@unique([jobId, importRunId])
  @@index([jobId])
  @@index([importRunId])
}

model JobTracking {
  id              String    @id @default(cuid())
  jobId           String    @unique
  status          JobStatus @default(NEW)
  statusChangedAt DateTime  @default(now())
  notes           String?
  nextAction      String?
  nextActionDate  DateTime?
  appliedAt       DateTime?
  resumePath      String?
  resumeVersion   String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  job Job @relation(fields: [jobId], references: [id])
}

model Setting {
  id        String   @id @default(cuid())
  key       String   @unique
  value     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum JobStatus {
  NEW
  INTERESTED
  APPLYING
  APPLIED
  INTERVIEWING
  OFFER
  REJECTED
  PASSED
  ARCHIVED
}

enum ImportRunStatus {
  PENDING
  SUCCESS
  FAILED
}

enum Priority {
  LOW
  MEDIUM
  HIGH
  URGENT
}
```

## Import Contract

### Endpoint

```text
POST /api/import-jobs
```

The same handler logic should be reusable for a JSON file import path.

### Request Body

```json
{
  "run_date": "2026-05-30",
  "source_name": "daily_job_automation",
  "jobs": [
    {
      "title": "Backend Engineer",
      "company": "ExampleCo",
      "location": "Remote",
      "remote_type": "remote",
      "salary_min": 150000,
      "salary_max": 190000,
      "source_url": "https://example.com/jobs/backend-engineer",
      "date_posted": "2026-05-29",
      "description": "Build APIs and platform services.",
      "fit_score": 86,
      "priority": "high",
      "matched_skills": ["Python", "Postgres", "APIs"],
      "missing_skills": ["Kubernetes"],
      "match_reason": "Strong backend/platform fit.",
      "concerns": "Kubernetes experience is preferred.",
      "suggested_action": "Apply today."
    }
  ]
}
```

### Import Behavior

The import service runs in **two persisted phases** so the raw payload is preserved for any parseable import request that has the minimum run envelope.

**Phase 0 — Parse and check the minimum envelope:**

1. Parse the JSON request body.
2. Validate only the minimum envelope needed to create an audit row:
   - `run_date` is a valid date string.
   - `jobs` exists and is an array.
3. If the request is malformed JSON or lacks the minimum envelope, return `400` and do not create an `import_runs` row. There is no reliable run date to attach to the audit record.

**Phase 1 — Persist the run (own transaction, commits immediately):**

4. Insert an `import_runs` row with `status = PENDING`, `raw_payload = <whole request body>`. Commit.

**Phase 2 — Validate and process jobs (single transaction for all job writes):**

5. Validate the full payload with Zod, including per-job fields and priority normalization.
6. If full validation fails, update the `import_runs` row to `status = FAILED` with `error_message` populated. Do not create or update any job, tracking, or recommendation rows.
7. De-duplicate within the incoming `jobs[]` array before writing recommendations. For each incoming job, compute both:
   - URL key, if `source_url` exists: `url:<normalized_source_url>`
   - fallback key: `fallback:<normalized_company>|<normalized_title>|<normalized_location>`

   Treat two rows in the same payload as duplicates when their URL keys match. If both rows have URL keys and they differ, keep both rows even if their fallback keys match; same company/title/location can represent distinct openings. If one or both rows lack a URL, use matching fallback keys as the duplicate signal. The first occurrence wins. If the payload contains the same job twice, only one `JobRecommendation` row should be created for it under this run.
8. For each unique incoming job:
   - Compute `normalized_source_url` (see URL Normalization).
   - Compute fallback dedupe key: `fallback:<normalized_company>|<normalized_title>|<normalized_location>`.
   - Store the fallback key in `fallback_dedupe_key` on every `Job` row.
   - If the incoming job has a URL, compute primary dedupe key: `url:<normalized_source_url>` and look up an existing `Job` by `dedupe_key`.
   - If no URL-key match was found, search by `fallback_dedupe_key`. This fallback lookup runs even when the incoming job has a URL, because an earlier import may have inserted the same job before the URL was available.
   - A fallback lookup is allowed to match only when it resolves to a single plausible existing job. If multiple existing URL-backed jobs share the same `fallback_dedupe_key` and none match the incoming URL key, treat the incoming row as a new job instead of guessing.
   - **Backfill on link:** if the incoming job has a URL but matched an existing job that was originally inserted under the fallback key, update the existing row's `source_url`, `normalized_source_url`, and `dedupe_key` to the URL-based key. Keep `fallback_dedupe_key` unchanged.
   - Upsert the job: insert if no match (creating `JobTracking` in the same operation), update `last_imported_at` if matched.
   - Insert a `JobRecommendation` for `(jobId, importRunId)`. The `@@unique([jobId, importRunId])` constraint prevents accidental duplicates.

9. On success: update the `import_runs` row to `status = SUCCESS`.
10. On any failure during Phase 2 job writes: the transaction rolls back (no partial job writes). Then update the `import_runs` row to `status = FAILED` with `error_message` populated. The raw payload is preserved from Phase 1.

`JobTracking` is required at the application invariant level (1:1 with `Job`) and is created in the same transactional step as the parent job. The Prisma parent-side relation is nullable to keep migrations, fixtures, and repair scripts practical; app queries should still treat missing tracking as data corruption. There is no "create tracking only if missing" branch during normal import — if the job is new, tracking is new; if the job exists, tracking already exists and is untouched by import.

## Deduplication

### Normalize Source URL

Apply, in order:

- Lowercase scheme and host.
- Strip default ports (`:80`, `:443`).
- Drop fragment (`#...`).
- Remove tracking query params: any param matching `utm_*`, plus `gclid`, `fbclid`, `mc_cid`, `mc_eid`, `ref`, `ref_source`, `source`.
- Sort remaining query params alphabetically by key (canonical ordering).
- Remove trailing slash from the path unless the path is `/`.
- Preserve all remaining path segments and query values verbatim — do not strip `www.`, since some hosts route `www` and apex to different content.

URL normalization is a best-effort canonicalization. Some sites (LinkedIn, Greenhouse session URLs) embed transient IDs in the path; these will not collapse perfectly. The fallback dedup key exists for exactly this reason.

### Dedupe Keys

`dedupe_key` is the canonical unique key for the row. It is URL-based when a URL is available, and fallback-based only for jobs imported without a URL.

Primary `dedupe_key`:

```text
url:<normalized_source_url>
```

Fallback `dedupe_key`, used only when no URL is available:

```text
fallback:<normalized_company>|<normalized_title>|<normalized_location>
```

`fallback_dedupe_key` is stored separately on every row using the same fallback value. It is indexed but **not unique**, because two distinct URL-backed jobs can legitimately share the same company, title, and location.

### Normalization Rules

For company, title, and location used in the fallback key:

- Trim whitespace.
- Lowercase.
- Collapse repeated whitespace.
- Remove leading and trailing punctuation.

If `location` is missing, use the empty string in the fallback key. Be aware that this can collide across remote/unknown-location listings for the same company+title — acceptable since those genuinely are likely the same role.

## Application Routes

### `/`

Redirect to `/today`.

### `/today`

Shows latest import run jobs.

Selection behavior:

- First, load the latest `import_runs` record overall, ordered by `run_date DESC, created_at DESC`.
- If the latest run overall is `SUCCESS`, use it for the job list.
- If the latest run overall is `FAILED`, render the failure state and offer a link to the next-most-recent `SUCCESS` run if one exists.
- The job list includes related jobs, recommendations, and tracking records.
- The job list excludes tracking statuses `PASSED` and `ARCHIVED` by default.

Controls:

- Include Passed/Archived toggle.
- Status quick actions.
- Open the matching posting detail page from the job title in a new tab.
- Open detail.

Empty / degenerate states:

- **No imports yet:** render an empty state with a link to `/import` and a one-line explanation.
- **Latest run is `FAILED`:** render the failure (with `error_message`) and a link to the next-most-recent `SUCCESS` run if one exists.
- **Latest `SUCCESS` run had zero jobs:** render "Latest run completed with no jobs" plus the run timestamp.
- **All jobs are `PASSED`/`ARCHIVED` and toggle is off:** render "All jobs in this run are hidden" with a one-click toggle.

### `run_date` semantics

`run_date` is treated as a **calendar date** (the date the automation ran), not a precise timestamp. Store it as a Postgres `date` via Prisma `DateTime @db.Date`, and render it as a date-only value so local timezone conversion cannot display the prior day. Tiebreaking between runs on the same `run_date` is done via `created_at`.

### `/board`

Shows jobs grouped by tracking status.

Controls:

- Move status.
- Open detail.

### `/jobs/[id]`

Shows job detail.

Editable fields (write to `job_tracking`):

- Status.
- Notes.
- Next action.
- Next action date.
- Applied date.
- Resume path.
- Resume version.

Read-only fields:

- Job title.
- Company.
- Location.
- Source URL.
- Job description (rendered as sanitized HTML).
- Recommendation context — `fit_score`, `priority`, `matched_skills`, `missing_skills`, `match_reason`, `concerns`, `suggested_action` from the **latest** `JobRecommendation` for this job. Latest means the recommendation whose `importRun` sorts first by `run_date DESC, created_at DESC`.
- Import history — list of all `JobRecommendation` rows for this job with their run dates.

Status transitions are unrestricted: any status can move to any other status. The Board and Detail UIs should not constrain transitions — Isaac may need to correct mistakes (e.g. Applied → Interested). When status is changed to `APPLIED`, set `applied_at` to now if it is empty. Do not automatically clear `applied_at` if the status later changes away from `APPLIED`.

### `/import`

Supports JSON file import. Uses the same import service as `/api/import-jobs`.

Flow:

1. **File picker** (or paste textarea fallback) accepts a JSON file.
2. **Preview page**: server validates the payload (Zod) without writing anything, and renders a summary:
   - Total jobs in payload.
   - N new jobs (no existing dedup match).
   - M duplicate jobs (existing match, would update `last_imported_at` and add a recommendation).
   - K invalid jobs (with per-job validation errors).
   - If `K > 0`, the Confirm button is disabled. V1 imports are all-or-nothing; invalid rows must be fixed in the source JSON before import.
3. **Confirm** button runs the actual import (Phase 1 + Phase 2 from Import Behavior). On success, redirect to `/today`. On failure, show the `error_message` from the resulting `import_runs` row.

The preview computes its counts using the same dedup logic the actual import uses, but inside a read-only transaction that is rolled back.

### `/settings`

Reads and writes the `settings` table (the DB is the source of truth — see Environment Variables).

Supports:

- Resume file path.
- High-fit threshold (integer, default `80`).

## API Routes

### `POST /api/import-jobs`

Imports a JSON payload.

### `PATCH /api/jobs/:id/tracking`

Updates personal tracking fields.

### `GET /api/import-runs/latest`

Returns latest successful import run with jobs.

This can be implemented as server-side data loading instead of a public API route if using Next.js app router server components.

### `GET /api/export`

Returns a single JSON document containing **all** `jobs`, `job_tracking`, `job_recommendations`, `import_runs` (with `raw_payload`), and `settings` rows. Intended as a manual backup / data-portability escape hatch — all data otherwise lives only in local Postgres.

Response shape:

```json
{
  "exported_at": "<iso-timestamp>",
  "jobs": [...],
  "job_tracking": [...],
  "job_recommendations": [...],
  "import_runs": [...],
  "settings": [...]
}
```

No corresponding import route in V1 — this is for backup, not round-trip restore.

### Local Security

V1 has no authentication because it is a local-only personal tool. The dev server should bind to localhost, API routes should not enable broad CORS, and the export endpoint should assume it contains private personal data.

## UI Requirements

### General

- The interface should feel like a practical workflow tool.
- Prefer dense, scannable layouts.
- Avoid marketing-style landing pages.
- Use clear status labels.
- Use visual emphasis for high-fit and apply-today jobs.

### Today Job Card

Required visible fields:

- Title.
- Company.
- Location.
- Remote type.
- Salary range if available.
- Fit score.
- Priority.
- Suggested action.
- Status.

Required actions:

- Open matching posting detail page from the title in a new tab.
- Interested.
- Applying.
- Applied.
- Passed.
- Archived.
- Open details.
- Open source listing.

### High-Fit Highlight

Use `fit_score >= high_fit_threshold`.

Default threshold:

```text
80
```

### Apply Today Badge

Show when **any** of:

- `suggested_action` matches `/\bapply\s*today\b/i`.
- `suggested_action` matches `/\bapply\b/i` AND `tracking.status` is NOT one of `APPLIED`, `REJECTED`, `PASSED`, `ARCHIVED`.
- `fit_score >= high_fit_threshold` AND `concerns` is null or empty AND `tracking.status` is NOT one of `APPLIED`, `REJECTED`, `PASSED`, `ARCHIVED`.

"No major concerns" is operationalized as **`concerns` is null or empty string** — there is no severity field to interpret.

## Validation

Use a schema validator such as Zod for import payloads.

Required job fields:

- `title` — must be non-empty after trim
- `company` — must be non-empty after trim

Strongly recommended job fields:

- `source_url`
- `location`
- `fit_score`
- `suggested_action`

Nullable fields should be accepted because job listings may be incomplete.

`salary_min` and `salary_max`, when present, are integers interpreted as **USD annual**. The daily automation is responsible for normalizing salary values into that shape. If a listing only has non-USD, hourly, monthly, equity-only, or unparseable salary data, those structured fields should be omitted or null; the original source value remains preserved only inside `raw_payload` / `raw_recommendation`. The validator does not enforce min <= max; just stores whatever the source emits.

## Error Handling

Import errors must:

- Not partially corrupt existing data — Phase 2 runs in a single transaction that rolls back on any failure.
- Preserve the raw payload for any request that passes the minimum envelope check — Phase 1 commits the `import_runs` row with `raw_payload` before any job processing begins.
- Mark the import run as `FAILED` and populate `error_message` (a concise human-readable summary; full validation errors can also be appended).
- Return the same `error_message` in the API response so the Import UI can render it.

Malformed JSON or requests missing the minimum envelope (`run_date` plus `jobs[]`) return a 400 with no `import_runs` row. Full validation errors after the minimum envelope is accepted create a `FAILED` import run with `raw_payload` and `error_message` preserved. This includes payloads with one or more invalid job rows; V1 does not partially import valid rows from an otherwise invalid payload.

## Initial Build Order

1. Create Next.js app scaffold.
2. Add Prisma and Postgres configuration.
3. Implement schema and migrations, including a seed step that writes `resume_file_path` and `high_fit_threshold` rows to `settings` from env vars on first run.
4. Implement URL normalization, fallback-key, and in-payload dedup helpers.
5. Implement two-phase import service.
6. Implement `/api/import-jobs`.
7. Implement Today view (latest run query + status quick actions).
8. Implement tracking update flow (`PATCH /api/jobs/:id/tracking`).
9. Implement Board view.
10. Implement Job Detail view (with sanitized HTML description rendering).
11. Implement Import view (file picker → preview → confirm).
12. Implement Settings view.
13. Implement `GET /api/export`.

## Test Plan

### Unit Tests

- URL normalization (lowercase host, tracker-param stripping, query sort, fragment drop, trailing slash, default-port stripping).
- Fallback dedupe key generation and `fallback_dedupe_key` persistence, including empty-location case.
- Apply-today detection (each of the three OR branches).
- High-fit detection.
- Import payload validation (required fields, trim-then-non-empty for title/company, in-payload dedup, failed-run preservation after minimum-envelope validation).
- Description HTML sanitization (no `<script>`, no inline event handlers).

### Integration Tests

- New job import creates job, recommendation, and tracking records.
- Duplicate URL import updates `last_imported_at` and preserves tracking.
- Fallback duplicate import preserves tracking.
- Job imported first without URL, then again with URL, results in a single `Job` row with the URL backfilled and `dedupe_key` promoted to the URL form.
- URL promotion preserves `fallback_dedupe_key` for future fallback matching.
- Same job appearing twice in one payload creates exactly one `JobRecommendation` for that run.
- Two payload rows with the same fallback key but different URL keys are kept as distinct jobs.
- Phase-2 failure leaves an `import_runs` row with `status = FAILED`, `error_message` populated, and the original `raw_payload` intact.
- Latest run query excludes Passed and Archived by default; toggle includes them.
- Two `import_runs` on the same `run_date` are tiebroken by `created_at` (newest wins).
- Tracking update endpoint changes status, sets `status_changed_at`, and updates notes.
- Settings seed writes env-var defaults on first run; subsequent env changes do not overwrite existing settings rows.

### Manual QA

- Import sample JSON.
- Confirm Today shows latest jobs.
- Mark a job Interested.
- Import same job again.
- Confirm status remains Interested.
- Mark a job Passed.
- Confirm it disappears from Today by default.
- Toggle include Passed/Archived.
- Confirm Passed job appears.
- Open source URL.
- Edit notes and next action.

## Required Inputs Before Implementation

- Sample JSON from the daily automation.
- Resume file path.
- Confirmation that the recommended stack is acceptable.
