# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Status

The repo contains the initial Next.js scaffold plus Prisma/Postgres database foundation. Implementation work still starts from `PRD.md` and `SPEC.md` — read both before making non-trivial changes. `SPEC.md` is the source of truth for the data model, import contract, routes, and dedupe rules; `PRD.md` is the source of truth for user-facing behavior and scope.

## Intended Stack (from SPEC.md)

- Next.js + TypeScript + Tailwind CSS
- Prisma ORM against local Postgres (Docker or local install)
- No authentication — local-only single-user app
- Zod for import payload validation

Current commands:

- `npm run dev` — start the local Next.js dev server.
- `npm run lint` — run ESLint.
- `npm run typecheck` — run TypeScript without emitting files.
- `npm run build` — create a production build.
- `npm run db:generate` — generate the Prisma client into `src/generated/prisma`.
- `npm run db:migrate` — run Prisma migrations against the configured Postgres database.
- `npm run db:seed` — seed initial settings from `.env` without overwriting existing rows.
- `npm run db:studio` — open Prisma Studio.

## Key Architectural Decisions

These are load-bearing and easy to get wrong if you only skim the spec:

### Job listings are separated from personal tracking state

Four core tables: `import_runs`, `jobs`, `job_recommendations`, `job_tracking`. The split between `jobs` (listing data) and `job_tracking` (Isaac's status, notes, next actions, and application metadata) exists specifically so that re-importing the same job on a later day **does not reset status or notes**. Do not collapse these into one table, and do not write import logic that touches `job_tracking` for existing jobs.

### Recommendation context is per-import-run, not per-job

`job_recommendations` is a join row between a `job` and an `import_run`. A single job accumulates one recommendation row per run it appears in — that's how recommendation history is preserved. Don't overwrite prior recommendations on re-import; insert a new row.

### Deduplication is two-tier

1. Primary key: `dedupe_key = url:<normalized_source_url>` when a URL exists — lowercase host, strip tracking params, trim trailing slash.
2. Fallback key: `fallback:<normalized_company>|<normalized_title>|<normalized_location>` — trim, lowercase, collapse whitespace, strip leading/trailing punctuation.

The canonical `dedupe_key` is unique. Jobs imported without a URL use the fallback value as their canonical key. Every job also stores `fallback_dedupe_key` separately with a non-unique index, so URL promotion does not erase the fallback lookup path. If two incoming rows both have different URL keys, do not merge them solely because the fallback key matches.

### Import is transactional and preserves raw payload on failure

For parseable requests with a valid `run_date` and `jobs[]` envelope, the full request body goes into `import_runs.raw_payload` *before* per-job processing. If processing fails, the run is marked `FAILED` but the payload is retained for debugging/replay. Wrap per-job upserts in a DB transaction so partial corruption can't happen.

### "Apply Today" and "High Fit" are computed, not stored

- High fit: `fit_score >= high_fit_threshold` (default 80, configurable via `settings` table).
- Apply Today: `suggested_action` contains "apply today", OR contains "apply" and status isn't terminal (Applied/Rejected/Passed/Archived), OR high-fit with no major concerns.

These should be derived in queries or view helpers — don't denormalize them onto `jobs` or `job_tracking`.

### Today view filtering

`/today` first checks the latest import run overall. If it failed, show the failure and link to the next-most-recent successful run if one exists. If the latest run succeeded, show jobs from that run, excluding tracking statuses `PASSED` and `ARCHIVED` by default. A toggle re-includes them. This is not the same query as `/board` — don't reuse one for the other.

## Import Contract

`POST /api/import-jobs` accepts the JSON shape documented in `SPEC.md` §Import Contract and `PRD.md` §Example Import Shape. The same import service must back both the API route and the `/import` UI page — do not duplicate the logic.

## Environment

```
DATABASE_URL="postgresql://jobboard:jobboard@localhost:5432/jobboard"
RESUME_FILE_PATH="/Users/isaaczhu/path/to/resume.pdf"
HIGH_FIT_THRESHOLD="80"
```

Resume is referenced by **local file path only** — V1 explicitly excludes file upload/storage. `RESUME_FILE_PATH` and `HIGH_FIT_THRESHOLD` are seed values only; the `settings` table becomes the source of truth after seeding.

## Build Order (from SPEC.md §Initial Build Order)

When implementing from scratch, follow the spec's ordering: scaffold → Prisma schema/migrations → import service + dedupe helpers → `/api/import-jobs` → Today → tracking updates → Board → Job Detail → Import UI → Settings. Earlier steps unblock later ones (e.g., Today depends on import working end-to-end).
