# Implementation Plan: Today Links to Posting Detail

**Branch**: `001-resume-tailoring` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)

**Input**: Corrected feature specification from `/specs/002-board-today-links/spec.md`

## Summary

Correct the Today job-title navigation target. Each Today job title should open the matching posting's existing JobBoard detail page (`/jobs/<job-id>`) in a new tab. The implementation should reuse stable internal job ids, keep the external Apply/source action separate, and remove the earlier Board-homepage/hash-anchor behavior from Today.

## Technical Context

**Language/Version**: TypeScript 5 with Node.js 22 runtime via Next.js 16 App Router

**Primary Dependencies**: Next.js, React, Prisma 7, Postgres, Tailwind CSS 4, existing JobBoard UI helpers

**Storage**: Existing Postgres job/tracking data only; no schema or data migration

**Testing**: Node built-in `node:test` with `node:assert/strict` through `npm run test`; `npm run typecheck`; `npm run lint`; `npm run build`; browser/manual validation against local JobBoard

**Target Platform**: Isaac's local macOS workstation, local-only JobBoard deployment

**Project Type**: Local web application with server-rendered Today and job detail pages

**Performance Goals**: Link rendering must not add database queries beyond existing Today/detail page loads; navigation uses normal internal links

**Constraints**: Preserve local-only trust model; preserve existing user/agent changes in the working tree; keep implementation small and reversible; do not introduce new tables, APIs, auth, or external network calls

**Scale/Scope**: Single-user local workflow; current Today run contains dozens of roles at most

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Local-Only Personal Workflow**: PASS. This is a local UI navigation change; no public exposure, auth, CORS, or data-sharing changes.
- **II. Listing Data and Personal Tracking Stay Separate**: PASS. No import, listing, tracking, or recommendation persistence changes.
- **III. Source-of-Truth Documentation Before Behavior Changes**: PASS. Tasks include `PRD.md` and `SPEC.md` corrections before behavior work.
- **IV. Test-First, Reversible Implementation**: PASS. Tasks require a failing pure link-helper test before implementation plus typecheck/lint/build validation.
- **V. Model and Prompt Safety**: PASS. No model or prompt behavior.
- **VI. Simple V1s Over Premature Platforms**: PASS. Uses the existing detail route; no new API, database table, modal, or routing subsystem.

## Project Structure

### Documentation (this feature)

```text
specs/002-board-today-links/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── posting-detail-link.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── board/board-client.tsx
│   ├── today/today-client.tsx
│   └── globals.css
└── lib/
    └── jobs/links.ts

tests/
└── job-links.test.ts

PRD.md
SPEC.md
AGENTS.md
```

**Structure Decision**: Keep the feature in the existing single Next.js app. Put posting-detail URL generation in a pure helper under `src/lib/jobs/links.ts` so Today and Board title links can share one stable internal detail-route convention.

## Phase 0: Research Decisions

See [research.md](./research.md). Key decisions:

- Use the existing `/jobs/<job-id>` posting detail route for Today title links.
- Render Today job titles as new-tab internal links with `target="_blank"` and `rel="noreferrer"`.
- Use stable internal job ids for URL generation.
- Remove the Today dependency on Board hash deep links for this corrected behavior.

## Phase 1: Design Artifacts

See [data-model.md](./data-model.md), [contracts/posting-detail-link.md](./contracts/posting-detail-link.md), and [quickstart.md](./quickstart.md).

### Post-Design Constitution Check

- **Local-only/privacy**: Still PASS. Internal navigation only.
- **Tracking separation**: Still PASS. No status/tracking write behavior changes.
- **Source-of-truth docs**: Still PASS. Source docs are included in implementation tasks.
- **Test-first**: Still PASS. Pure helper test precedes production helper/UI changes.
- **Model/prompt safety**: Not applicable and no violation.
- **Simple V1**: Still PASS. Existing detail route avoids heavier Board targeting machinery.

## Complexity Tracking

No constitution violations. No complexity exceptions required.
