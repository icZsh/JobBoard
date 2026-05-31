# Personal Job Tracker PRD

## Summary

Build a local-only personal job tracking web application powered by the daily job recommendation automation. The app should help Isaac review recommended jobs, decide what to pursue, track applications, and preserve recommendation context over time.

This is not a public job board. V1 is a private workflow tool for one person.

## Problem

Daily recommended job listings are useful, but they need a persistent place to become decisions and actions. Without a tracker, jobs can be duplicated across days, status gets lost, promising roles are easy to forget, and notes or application details are scattered.

## Goal

Create a local web app that turns the daily job recommendation output into a structured review and application pipeline.

The app should answer:

- What jobs were recommended in the latest run?
- Which jobs are high fit?
- Which jobs should be applied to today?
- Which jobs have already been passed, archived, applied to, or moved forward?
- What notes, next actions, and application context are attached to each job?

## Users

### Primary User

Isaac, using the app locally on his own machine.

## V1 Scope

### Included

- Local-only web application.
- Postgres-backed persistence.
- Import jobs from a JSON file or API endpoint.
- Store the raw import payload in the database for accepted import requests.
- Normalize job listings into database records.
- Deduplicate jobs across import runs.
- Preserve personal tracking state across repeated imports.
- Show the latest import run in a Today view.
- Exclude Passed and Archived jobs from Today by default, with a toggle to include them.
- Provide a status-based job board.
- Provide a job detail view.
- Allow editing personal tracking fields.
- Highlight high-fit jobs.
- Show jobs recommended for "apply today".
- Store a local resume file path, not the resume file itself.
- Provide a JSON export endpoint for manual backup.

### Excluded From V1

- Public job board features.
- User accounts and authentication.
- Employer accounts.
- Payments.
- Automated scraping inside the app.
- Resume or cover letter generation, and any cover letter tracking fields.
- File upload or file storage for resumes.
- Analytics dashboard.
- Multi-user collaboration.
- Hosted deployment.

### Security Assumption

V1 is local-only and unauthenticated. The app should be served on localhost, should not enable broad CORS, and should treat export data as private personal data.

## Product Views

### Today

The Today view is the daily review surface.

It should show jobs from the latest import run, excluding jobs with `Passed` or `Archived` status by default.

Expected capabilities:

- View latest recommended jobs.
- See title, company, location, remote type, salary if available, fit score, priority, and recommendation context.
- Highlight high-fit jobs.
- Clearly indicate "Apply Today" jobs.
- Quick status actions:
  - Interested
  - Applying
  - Applied
  - Passed
  - Archived
- Toggle visibility for Passed and Archived jobs.

### Board

The Board view is the application pipeline.

Statuses:

- New
- Interested
- Applying
- Applied
- Interviewing
- Offer
- Rejected
- Passed
- Archived

Expected capabilities:

- Group jobs by status.
- Move jobs between statuses.
- Open job details from a board item.
- Preserve status across future imports.

### Job Detail

The Job Detail view is the main workspace for a single job.

Expected content:

- Job title.
- Company.
- Location.
- Remote type.
- Salary range if available (USD annual).
- Source URL.
- Date posted if available.
- First seen date (from job's `created_at`).
- Last imported date.
- Job description (rendered as sanitized HTML).
- Fit score.
- Priority (from latest recommendation).
- Matched skills.
- Missing skills.
- Match reason.
- Concerns.
- Suggested action.
- Status.
- Status changed date.
- Notes.
- Next action.
- Next action date.
- Application date.
- Resume path or resume version label.
- Import history (list of runs that included this job).

Expected actions:

- Update status (any status to any other status; no transition constraints).
- Edit notes.
- Edit next action.
- Edit next action date.
- Mark applied. When a job is marked Applied, set the applied timestamp if it is empty.
- Store application metadata.
- Open source listing.

Priority is read-only and reflects what the latest recommendation said. "Latest" means the recommendation from the job's newest successful import run, ordered by `run_date` and then import creation time.

### Import

The Import view or endpoint supports ingesting the daily automation output.

V1 should support:

- Importing a structured JSON payload from a file.
- Importing the same structured JSON payload through an API endpoint.
- Storing raw payload for every import run.
- Upserting normalized jobs.
- Creating recommendation records linked to an import run.
- Creating tracking records for new jobs.
- Preserving tracking records for duplicate jobs.
- Rejecting invalid payloads as all-or-nothing imports; V1 does not partially import valid rows from an otherwise invalid file.
- Preserving invalid direct API import payloads as failed runs when the request has a valid `run_date` and `jobs[]` envelope. Malformed JSON or requests missing that envelope may return an error without creating an import run.

### Settings

The Settings view should be minimal in V1.

Expected fields:

- Resume file path.
- High-fit score threshold, default `80`.

## Recommendation Context

Each job recommendation should store:

- Fit score.
- Priority, normalized case-insensitively from the automation payload.
- Matched skills.
- Missing skills.
- Match reason.
- Concerns.
- Suggested action.
- Raw recommendation JSON.

## Prioritization Rules

### High Fit

A job is considered high fit when `fit_score >= 80` by default.

### Apply Today

A job is shown as "Apply Today" when any of:

- `suggested_action` matches `/\bapply\s*today\b/i`.
- `suggested_action` matches `/\bapply\b/i` and status is not Applied, Rejected, Passed, or Archived.
- High fit (`fit_score >= high_fit_threshold`) and `concerns` is blank and status is not Applied, Rejected, Passed, or Archived.

## Deduplication Rules

### Primary Deduplication

Use normalized `source_url`.

### Fallback Deduplication

Use normalized:

- Company.
- Title.
- Location.

Fallback deduplication should run when a job has no source URL and when a URL-based lookup misses. This lets the app connect a later URL-bearing import to an earlier no-URL import of the same job.

The fallback key should be stored separately from the primary unique dedupe key. The primary `dedupe_key` can be promoted from fallback-based to URL-based when a URL appears later, but the separate fallback key should remain available for future fallback matching.

When two incoming jobs both have different source URLs, they should not be merged only because company, title, and location match. Same-title openings at the same company can be distinct roles.

### Duplicate Behavior

When a duplicate job is imported:

- Preserve existing tracking status and notes.
- Update `last_imported_at`.
- If the existing job was created without a URL and the duplicate import now has one, backfill the URL fields and promote the primary dedupe key to the URL-based key while preserving the separate fallback key.
- Attach the new recommendation to the current import run.
- Do not reset status to New.

## Data Requirements

### Job Listing

- Title.
- Company.
- Location.
- Remote type.
- Salary minimum, normalized as USD annual if available.
- Salary maximum, normalized as USD annual if available.
- Source URL.
- Date posted.
- Description.
- First seen timestamp.
- Last imported timestamp.
- Dedupe key.

### Personal Tracking

- Status.
- Status changed timestamp.
- Notes.
- Next action.
- Next action date.
- Applied timestamp.
- Resume path or resume version.
- Updated timestamp.

Priority is not a personal field — it lives on the recommendation and is set by the automation.

When status changes to Applied, the app should fill the applied timestamp if it is empty. If the status later changes away from Applied, the timestamp should remain unless Isaac edits it directly.

Structured salary fields are V1-only normalized fields. Non-USD, hourly, monthly, equity-only, or unparseable salary text should be omitted from structured salary fields and preserved in the raw import payload.

## Example Import Shape

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

## Success Criteria

V1 is successful if Isaac can:

- Import a daily job recommendation payload.
- Review the latest recommended jobs in Today.
- Quickly identify high-fit and apply-today jobs.
- Move jobs through the application pipeline.
- Preserve notes and statuses across duplicate imports.
- Open a job detail page and edit personal tracking data.
- Store the local resume path used for applications.

## Open Implementation Inputs

Before building, provide:

- A real or anonymized sample JSON payload from the daily automation.
- The local resume file path to store in settings.
- Confirmation of the final stack, currently assumed to be Next.js, TypeScript, Prisma, Tailwind, and Postgres.
