# Docker self-hosting

## Outcome and isolation

A new user can deploy with Docker Compose alone, create one administrator, configure a US job search, confirm an optional resume, and receive daily rule-ranked recommendations without Codex, launchd, a host language runtime, or a model key.

Implementation continues from ATS collector commit `af4a4c5` in `/Users/isaaczhu/JobBoard-self-hosted`, branch `feature/docker-self-hosting`, moved with `git worktree move`. No production cutover, changes to the original main checkout, existing launch agents, automation, Vault, running services, or production database are part of this feature. The admin-auth checkout is read-only reference material. Validation uses Compose project `jobboard-selfhost-dev` and separate ports and volumes.

## Required behavior

- One-time atomic administrator bootstrap, authenticated pages/APIs/actions, login/logout, private controlled file downloads. No registration or multi-tenant model.
- Web-managed timezone, daily time (default 09:00), pause/run-now, US locations/remote preferences, titles, skills, experience, salary, job age and result count; no user-authored JSON/regex.18 editable ATS company templates; supported Ashby/Greenhouse/Lever URL addition.
- Configuration persists in PostgreSQL; every run captures an immutable configuration snapshot. Edits affect subsequent runs. No seed or startup overwrites.
- Independent worker uses session advisory lock, durable DB queue and unique scheduled identities, latest-only missed-run recovery, per-request timeouts/retries and shared import idempotency. Successful sources publish despite other failures. All-source failure and zero matches preserve existing Board data and clearly identify coverage/outcome.
- Resume upload supports PDF/DOCX/Markdown/TXT, max 10 MB by default, text extraction without OCR, editable preview and explicit confirmation. A failed upload never replaces the active resume. Files live in a persistent volume with DB-managed identifiers. Candidate facts come from confirmed text. Gemini is optional and keys stay in the environment; generated resumes remain Markdown.
- Compose web/worker/Postgres/migration services run Node 22 Debian on amd64/arm64. Database health precedes migration; successful migration precedes app startup. DB has no host port; web binds host loopback.
- 30-day raw snapshot retention excludes nonterminal recovery data. Run summaries, observation/dedup records and tracking history persist. Full backup includes database, files and deployment environment.

## Out of scope

Redis, external task queues, OCR, international filtering, global company discovery, registration, multi-tenancy and public deployment. The legacy CLI collector/import commands retain their separate manual contract.

## Acceptance

Clean Compose setup; authenticated configuration/collection; timezone and DST boundaries; partial/all-failed/zero outcomes; concurrent enqueue and idempotent publication; abrupt worker termination and DB interruption; all resume formats and confirmation/controlled downloads; persistent admin/config/files/notes/status through rebuild and full restore; isolation baseline unchanged.
