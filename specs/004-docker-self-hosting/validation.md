# Validation

Validated on September 5, 2026, in the existing collector worktree after moving it to `/Users/isaaczhu/JobBoard-self-hosted` and renaming its branch to `feature/docker-self-hosting`. The collector base commit remains `af4a4c5`.

## Automated checks

| Check | Result |
| --- | --- |
| Docker unit + PostgreSQL integration suite | 126 passed, 0 failed, 0 skipped |
| TypeScript, ESLint, `git diff --check` | Passed |
| Production image build | Passed for both `linux/arm64` and `linux/amd64` in one manifest |
| Node / PostgreSQL adapter / PDF.js in amd64 image | Passed under emulation; Node 22.23.2, pg 8.23.0, PDF.js 6.3.289 |
| amd64 web runtime | Healthy; native scrypt login, session and DB-backed configuration read passed |
| HTTP acceptance on rebuilt arm64 web | 14 groups passed, 0 failed |

Database integration runs in the opt-in `test-db` service, with an independent in-memory PostgreSQL database. It tests the existing import/tracking guarantees along with atomic first-admin races, immutable config snapshots, timezone/DST/skipped-date schedules, queued trigger deduplication, lease loss/fencing, exact import response replay, payload conflict rejection, partial/all-failed/empty outcomes, raw-file retention and actual managed-resume transactions. DOCX tests cover forged ZIP size declarations with actual inflation bounds, CRC and directory consistency. No real model API was called.

HTTP checks cover seven anonymous page redirects, twelve protected API surfaces, session flags, login failure, same-origin validation, closed setup, invalid-config preservation, exact upload/download bytes for all four formats, encrypted/invalid files, empty confirmation, tracking/notes preservation on re-import and server-side logout revocation. A matching untrusted Host/Origin was additionally rejected with 403 on the real setup endpoint. The script is `scripts/selfhost/check-http.mjs` and requires an explicit loopback target and disposable credentials.

## Real worker and browser checks

All services used project `jobboard-selfhost-dev`, web port 3017, its own network and database/files volumes. There was no database host port.

- Browser: created the single administrator, saved preferences with the schedule paused, uploaded a PDF, edited/confirmed its extracted text, then verified an encrypted PDF returned an error while the previous resume stayed active. Today rendered collection status and jobs, accepted an Interested action, and visibly disabled tailoring with a missing-key explanation.
- Twenty concurrent manual triggers returned one run ID. The worker was killed with SIGKILL during RUNNING. Restart recovered the same run at attempt 2; all 18 sources succeeded and exactly one keyed import existed.
- A real collection with Adonis plus an intentionally nonexistent Ashby board produced PARTIAL and published the successful source. Only the failed source produced FAILED. An unmatched title preference produced EMPTY. FAILED/EMPTY left existing job/import counts unchanged.
- A real future UTC schedule minute generated and completed a run without a manual trigger. Original preferences and pause state were restored afterward. Pure tests separately cover user timezone/DST behavior.
- PostgreSQL was stopped during RUNNING, kept unavailable briefly and restarted. The worker recovered automatically at attempt 2 with one successful import for the same run identity.

## Rebuild, backup and restore

Containers were rebuilt/recreated while retaining the original test account, configuration, confirmed resume and job tracking. The complete backup was made with the worker deliberately stopped; afterward web resumed and worker remained stopped, confirming the backup preserves prior service state.

The backup contained a custom-format database dump, files tarball, deployment environment and image inventory. It was restored into project `jobboard-selfhost-dev-restore` on port 3018, using separate database/files volumes. Before any subsequent edits, hashes matched for:

- Administrator identity/password hash/role/active state.
- Nine complete application/configuration/history tables: one bootstrap, one config, six collection runs, nine resume files, two settings, ten jobs, ten tracking rows, 22 recommendations and eight imports.
- All 33 stored files by relative key and content hash.

Login and saved preferences worked in the restored instance. A second restore attempt correctly refused the nonempty database. Combining both instances' cookies retained independent sessions; confirming Candidate B only in the restored instance preserved the original instance's active Candidate A, and the foreign file ID returned 404. Logging out of the restored instance kept the original session valid.

## Isolation and handoff

The original main checkout remained clean at `8f60675e9fe5ad03b3a63ba7cf5d2b2c4ffb22f4`. All 152 captured file hashes remained unchanged, including original runtime configuration, scheduled-task configuration/import script, LaunchAgents and the read-only admin-auth worktree files. No automation API, production import, main checkout switch, production migration or Vault write was performed.

Acceptance containers and temporary browser tab were removed/stopped after validation. Named test volumes and the private backup/evidence directory remain available; no production switch occurred. Raw local evidence is ignored by Git under `.selfhost-validation/` and is not part of the distributable checkout.

## Scope of verification

Real public ATS reads were exercised; their future availability and schema stability cannot be guaranteed. Gemini remains an optional extension: prompt isolation and generated-file transactions were tested with injected responses, while a real paid model call was deliberately not required. OCR, public deployment, account registration and multi-tenancy remain outside this feature. amd64 validation used emulation on an arm64 host; both architecture-specific builds and runtime smoke checks passed.
