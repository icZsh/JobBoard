# Implementation plan

Use standalone TypeScript modules and a CLI in the existing repository. No dependencies, migrations, UI, new background service or server restart. Reuse the existing sanitized history snapshot and identity matching. Public employer data is stored under the automation's discovery-state directory as atomic JSON files; agent-readable queues exclude personal notes and resume contents.

1. Write fixture-based tests and implement public ATS adapters with complete fetch/failure semantics.
2. Write tests for persistent pool merging, preliminary screening and history-aware ordering.
3. Implement registry bootstrap, bounded scan/cache CLI and readable queue/funnel reports.
4. Validate a real initial scan; fix coverage and parser issues; run all existing tests, typecheck, lint and an isolated build.
5. Install tested files and integrate the existing import handoff. Update the existing automation through its supported tool while preserving schedule, model and settings.
6. Verify the installed CLI and importer's read-only discovery mode; leave today's shortlist and all tracking untouched.

Constitution: local-only data (pass), listing/tracking separation (pass), PRD/SPEC/spec updates (included), meaningful tests before implementation (required), untrusted text confined to data (pass), no unnecessary services (pass). Install only the explicit staged delta and preserve yesterday's uncommitted work.
