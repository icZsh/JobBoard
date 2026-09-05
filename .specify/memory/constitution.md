<!--
Sync Impact Report
Version change: template -> 1.0.0
Modified principles: template placeholders -> JobBoard concrete principles
Added sections: Product Scope Boundaries; Development Workflow and Quality Gates
Removed sections: placeholder-only template sections
Templates requiring updates: ✅ reviewed .specify/templates/plan-template.md; ✅ reviewed .specify/templates/spec-template.md; ✅ reviewed .specify/templates/tasks-template.md
Follow-up TODOs: none
-->

# JobBoard Constitution

## Core Principles

### I. Local-Only Personal Workflow

JobBoard MUST remain a private, local-first workflow tool for Isaac. Features MUST assume a
single trusted local user, avoid public job-board behavior, and treat exported job data, resume
content, and recommendation history as private personal data. Any change that would expose the
app beyond localhost or a trusted LAN MUST add explicit security review before implementation.

### II. Listing Data and Personal Tracking Stay Separate

Job listing data and Isaac's personal tracking state MUST remain separate. Imports MAY update
listing metadata and recommendation history, but they MUST NOT reset notes, status, next actions,
application dates, resume path, or resume version for an existing job. This separation is the
load-bearing guarantee that repeated daily imports do not erase human decisions.

### III. Source-of-Truth Documentation Before Behavior Changes

Non-trivial product behavior changes MUST update the project source-of-truth documents before or
with implementation. `PRD.md` describes user-facing scope and product behavior. `SPEC.md`
describes technical contracts and data model rules. Feature-specific Spec Kit artifacts under
`specs/` refine a scoped change but MUST NOT contradict `PRD.md` or `SPEC.md` without explicitly
amending them.

### IV. Test-First, Reversible Implementation

New behavior MUST be covered by automated tests before production code when practical. Tests MUST
cover the behavior that makes the feature valuable and the safety cases that would be expensive to
catch manually. Implementation should be small, reversible, and validated with the repository's
existing test, typecheck, lint, and build commands before runtime restart or deployment.

### V. Model and Prompt Safety

Any LLM-backed feature MUST treat external content as untrusted input. Job descriptions,
recommendation text, and model output MUST NOT be allowed to choose filesystem paths, mutate
tracking fields beyond the requested feature scope, or override application rules. Model output
MUST be validated with a strict schema before being persisted or shown as trusted application state.

### VI. Simple V1s Over Premature Platforms

JobBoard features SHOULD start as the smallest useful workflow that solves Isaac's immediate need.
Avoid new tables, background workers, batch actions, rich editors, auth systems, or multi-user
abstractions unless the current feature cannot deliver value without them. Complexity must pay rent
in the active user flow.

## Product Scope Boundaries

- JobBoard is a local personal job tracker, not a public job board or hosted ATS.
- Resume tailoring is allowed as a deliberate post-V1 feature, but cover letters, cover-letter
  tracking fields, batch generation, and resume history tables remain out of scope until specified.
- Secrets such as API keys MUST stay in environment configuration and MUST NOT be written to the
  database, generated files, prompts, logs, or user-visible UI.
- Runtime-disrupting actions, including restarting the JobBoard LaunchAgent, require Isaac's
  confirmation before execution.

## Development Workflow and Quality Gates

- Spec Kit artifacts MUST be used for new features: specification, implementation plan, tasks, and
  task-by-task completion tracking.
- User stories must be independently testable and should deliver usable increments in priority
  order.
- Tests that call external paid or network services MUST be avoided by default; use dependency
  injection or mocks for model providers and filesystem writes.
- Validation before completion SHOULD include `npm run test`, `npm run typecheck`, `npm run lint`,
  and `npm run build`, with any local database prerequisite called out clearly.
- Existing user or agent changes in the working tree MUST be preserved unless Isaac explicitly asks
  for cleanup or rewrite.

## Governance

This constitution supersedes ad-hoc implementation preferences for JobBoard. Amendments require a
brief rationale, a semantic version bump, and a Sync Impact Report in this file. MAJOR changes
redefine or remove principles; MINOR changes add principles or materially expand governance; PATCH
changes clarify wording without changing meaning. Every Spec Kit plan must include a constitution
check and either pass it or justify any violation before implementation.

**Version**: 1.0.0 | **Ratified**: 2026-06-11 | **Last Amended**: 2026-06-11
