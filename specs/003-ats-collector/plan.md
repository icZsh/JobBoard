# Implementation Plan

## Stack and boundaries

Use Node 22, TypeScript/tsx, the existing Zod and sanitize-html dependencies, and Node's test runner. Add modules under `src/lib/collector`, CLI entry points under `scripts/collector`, editable JSON under `config/collector`, and mocked tests under `tests`. No Next.js route or Prisma schema changes.

Adapters normalize provider responses. Rules produce deterministic review context. The runner merges sources, maintains an isolated observation ledger, and writes payload, report and snapshot files. Collection and explicit import are separate commands. File writes use atomic replacement and an output-directory lock. Import uses a per-endpoint payload hash and a persistent pending marker for ambiguous outcomes.

## Constitution check

- Local-only: pass; local artifacts, explicit loopback-only import target.
- Tracking separation: pass; no tracking or database mutation during collection.
- Source of truth: pass; PRD/SPEC amended with independent opt-in collector scope.
- Test-first: pass; provider fixtures, screening boundaries, failed-source reconciliation and submission idempotency tested with injected HTTP.
- Model safety: pass; no model calls; external job text is data only.
- Simplicity: pass; no new tables, services, UI, deployed scheduler, or dependencies.

## Validation

Run collector tests with mocked HTTP, existing unit/integration tests against an isolated test database, typecheck, lint, and build. Read-only live collection may exercise the selected company feeds and produce local artifacts; it must not POST to the active JobBoard. Verify the original checkout and automation files remain unchanged.

## Official references

- https://developers.ashbyhq.com/docs/public-job-posting-api
- https://docs.greenhouse.io/job-board.html
- https://github.com/lever/postings-api
