# Implementation Plan: Resume Tailoring

**Branch**: `001-resume-tailoring` | **Date**: 2026-06-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-resume-tailoring/spec.md`; implementation detail source from `/RESUME_TAILORING_PLAN.md`.

## Summary

Add a resume-only `Tailor resume` action to the existing Job Detail tracking panel and the Today page's expanded Details area. The server reads Isaac's configured Markdown/plain-text base resume, gathers the selected job's listing and latest recommendation context, calls a narrow Gemini adapter for strict JSON resume output, validates the response, writes a timestamped Markdown file under the Jobs vault, and updates `job_tracking.resumePath` / `resumeVersion`. The client renders inline loading, success, warning, change, and error states without marking unrelated unsaved tracking edits as saved.

## Technical Context

**Language/Version**: TypeScript 5 with Node.js 22 runtime via Next.js 16 App Router

**Primary Dependencies**: Next.js, React, Prisma 7, Postgres, Zod 4, Tailwind CSS 4, `@google/genai` for Gemini provider calls, Node `fs/promises` and `path`

**Storage**: Existing Postgres tables (`settings`, `jobs`, `job_recommendations`, `job_tracking`) plus Markdown files written under the configured tailored-resume root

**Testing**: Node built-in `node:test` with `node:assert/strict`, executed through `tsx --env-file=.env --test --test-reporter=spec tests/**/*.test.ts`; typecheck with `tsc --noEmit`; lint with ESLint; build with Next.js

**Target Platform**: Isaac's local macOS workstation, local-only JobBoard deployment

**Project Type**: Local web application with server-side API route and client-side tracking panel

**Performance Goals**: One-click user flow; no full-page blocking during generation; prompt inputs capped to avoid unbounded cost/time; no real external generation calls in automated tests

**Constraints**: Resume-only V1; Markdown/plain-text base resume only; no cover letters, PDF export, batch generation, resume history table, or runtime LaunchAgent restart without Isaac's confirmation; no secrets in database/prompts/logged UI output; external job text treated as untrusted context

**Scale/Scope**: Single-user local workflow; one job tailored per explicit click; timestamped files provide V1 history

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Local-Only Personal Workflow**: PASS. Feature remains local JobBoard UI/API and does not add auth, public hosting, broad CORS, or external exposure. Privacy boundary is documented because resume text and job context are sent to the configured provider only when Isaac clicks.
- **II. Listing Data and Personal Tracking Stay Separate**: PASS. No listing schema changes. Only existing `job_tracking.resumePath` and `resumeVersion` are updated after successful tailoring.
- **III. Source-of-Truth Documentation Before Behavior Changes**: PASS. `PRD.md`, `SPEC.md`, `.env.example`, and `CLAUDE.md` are explicit tasks before runtime behavior changes so resume tailoring is documented as post-V1 while cover letters remain excluded.
- **IV. Test-First, Reversible Implementation**: PASS. Tasks require schema/output tests before production code and dependency injection for provider/filesystem seams.
- **V. Model and Prompt Safety**: PASS. Prompt construction treats job content as untrusted, validates strict JSON, and keeps the app in control of filesystem paths and DB writes.
- **VI. Simple V1s Over Premature Platforms**: PASS. No new DB table, modal workbench, preview editor, batch flow, or PDF pipeline.

## Project Structure

### Documentation (this feature)

```text
specs/001-resume-tailoring/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── tailor-resume-api.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── api/jobs/[id]/tailor-resume/route.ts
│   ├── jobs/[id]/tracking-form.tsx
│   └── today/today-client.tsx
├── lib/
│   ├── jobs/tracking.ts
│   ├── jobs/recommendations.ts
│   ├── settings.ts
│   └── resume/
│       ├── errors.ts
│       ├── gemini-client.ts
│       ├── input.ts
│       ├── output.ts
│       ├── prompt.ts
│       ├── schema.ts
│       └── tailor-service.ts

tests/
├── resume-input.test.ts
├── resume-output.test.ts
├── resume-schema.test.ts
└── resume-tailor-service.test.ts
```

**Structure Decision**: Use the existing single Next.js app structure. Resume-specific logic lives under `src/lib/resume/` to keep the route thin and make pure helpers testable. The primary UI remains inside the existing job detail `TrackingForm`, with a lightweight Today details shortcut that calls the same route because daily review is Isaac's highest-friction entry point.

## Phase 0: Research Decisions

See [research.md](./research.md). Key decisions:

- Direct Gemini API adapter in TypeScript, not Hermes CLI or another agent process.
- Markdown/plain-text base resumes only for V1; reject PDF/Office/image/binary paths before provider calls.
- Strict JSON model contract validated by Zod; no partial Markdown fallback.
- Timestamped filesystem files provide V1 history; no new database table.
- Inline tracking panel UX; no modal, editor, preview, or batch UI.

## Phase 1: Design Artifacts

See [data-model.md](./data-model.md), [contracts/tailor-resume-api.md](./contracts/tailor-resume-api.md), and [quickstart.md](./quickstart.md).

### Post-Design Constitution Check

- **Local-only/privacy**: Still PASS. Contract is a local POST route with no public exposure changes; errors are concise and secrets stay server-side.
- **Tracking separation**: Still PASS. Data model explicitly reuses `job_tracking.resume_path` and `resume_version`; no import behavior changes.
- **Source-of-truth docs**: Still PASS. Tasks include docs updates before implementation.
- **Test-first**: Still PASS. Tasks include tests for schema/output/input/service seams before code.
- **Prompt safety**: Still PASS. Contract and data model keep provider output separate from path generation and DB updates.
- **Simple V1**: Still PASS. Later enhancements remain excluded.

## Complexity Tracking

No constitution violations. No complexity exceptions required.
