<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/002-board-today-links/plan.md
<!-- SPECKIT END -->

# JobBoard — agent instructions

Shared source of truth for Codex / Cursor / Claude Code (≥2.1.277). Prefer this file over tool-specific duplicates.

## Status

Initial Next.js scaffold + Prisma/Postgres foundation. Non-trivial work starts from `PRD.md` and `SPEC.md` — `SPEC.md` owns data model, import contract, routes, dedupe; `PRD.md` owns user-facing behavior and scope.

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:studio
```

Stack: Next.js + TypeScript + Tailwind, Prisma → local Postgres, no auth (local single-user), Zod for import validation.

## Load-bearing architecture

- **Listings vs tracking:** `jobs` (listing) vs `job_tracking` (status/notes). Re-import must not reset tracking.
- **Recommendations per import run:** `job_recommendations` joins job ↔ import_run; insert new rows on re-import, don't overwrite history.
- **Two-tier dedupe:** URL key when present; else fallback `company|title|location`. Don't merge different URL keys solely on fallback match.
- **Import:** persist `raw_payload` before per-job processing; mark `FAILED` but keep payload; transactional per-job upserts.
- **High fit / Apply Today:** computed, not stored columns.
- **Today vs Board:** different queries — don't reuse one for the other.

`POST /api/import-jobs` and `/import` UI must share one import service.

## Env

See `.env.example`. Resume is a local file path only (no upload in V1). Keep API keys in `.env`, never in the DB.
