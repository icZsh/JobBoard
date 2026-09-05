# Run JobBoard with Docker

This is a private, single-administrator installation. Docker Engine with the Compose and Buildx plugins (included in Docker Desktop) is the only runtime prerequisite. Clone/download this branch; host Node, Python, Codex and launchd are not needed. Windows users can run the shell helpers in WSL, or use the equivalent Compose commands below.

## First start

```sh
cp .env.example .env
# Set POSTGRES_PASSWORD to a long random URL-safe password in .env.
# JOBBOARD_PORT defaults to 3010; set another free port if needed.
docker compose --env-file .env -f compose.selfhost.yml up -d --build --wait
```

Open [JobBoard](http://localhost:3010). First setup creates the only administrator and saves your timezone, daily time, search preferences and companies. The browser detects an initial timezone; verify it before saving. Use Settings to upload an optional resume, review/edit extracted text and confirm it. Start the first collection from the setup completion screen or Today. Subsequent daily collection is automatic when enabled; its default is 09:00 in your chosen timezone.

Only localhost is exposed. PostgreSQL has no host port. `compose.selfhost.yml` is separate from the old local `docker-compose.yml`, and has no fixed container names, host path mounts, production URLs or startup seeding. Do not combine those two Compose files.

The first build needs network access to image/package registries; collection needs access to the selected public ATS APIs. Runtime images support native Linux amd64 and arm64. No architecture-specific host binaries are copied into containers. For a multi-architecture image release, use Docker Buildx with both platforms and your own image registry; a normal local build selects the host architecture.

## Configure and operate

- **Settings:** change the IANA timezone, daily time, pause schedule, US cities/remote preference, titles, skills, experience range, salary preference, age and recommendation limit. These are preferences for deterministic scoring; unknown source dates/salaries/experience are clearly identified rather than invented.
- **Companies:**18 initial templates; enable/disable, delete, or add an Ashby, Greenhouse or Lever board by its official ATS recruitment URL. Only these provider hosts are accepted. A valid URL can still identify a closed/renamed board; the run report shows that source failure.
- **Resume:** PDF, DOCX, Markdown or TXT, at most 10 MB by default. Confirm the editable extracted text before use. Image-only scans require you to supply text yourself; OCR is not included. Encrypted, damaged and empty files return an error without replacing the active resume.
- **Today:** latest run outcome, last successful run, next scheduled run and per-company coverage; run now/retry queues work without holding the browser request open. Multiple clicks while a run is pending resolve to the same queued/active run.
- **Tailoring:** optional. Add `GEMINI_API_KEY` to `.env`, then recreate the web service. This sends the confirmed resume and the selected job context to Gemini only when you request tailoring. Without a key, all collection, rule scoring, Board and tracking functionality works; tailoring controls explain why unavailable. Downloads remain Markdown.

Environment variables carry deployment parameters and optional model credentials only. Search configuration lives in PostgreSQL and is not overwritten at startup or on upgrade. `HIGH_FIT_THRESHOLD` and old local resume path environment variables are not required for this installation.

```sh
scripts/selfhost/compose.sh ps
scripts/selfhost/compose.sh logs --tail=100 worker web migrate
scripts/selfhost/compose.sh stop             # Preserve volumes
scripts/selfhost/compose.sh up -d --wait     # Resume
```

The helper always selects `compose.selfhost.yml` and the checkout's `.env`, even when called from another directory. To keep another isolated instance's configuration elsewhere, set `JOBBOARD_ENV_FILE=/absolute/path/to/another-instance/.env`. Set a distinct `COMPOSE_PROJECT_NAME` and port in that file; Compose prefixes both persistent volumes with the project name. Do not use `down -v` unless you intend to delete that instance's database and files.

## Scheduling, failures and recovery

Daily schedule calculations use the saved IANA timezone, including daylight saving changes. On a skipped local time the run occurs at the first available minute afterward; a repeated local time runs once. Restart queues at most the latest overdue daily slot, not every missed date. Pausing stops new scheduled slots; an already queued/running job retains its captured configuration and may finish. Manual runs remain available while paused.

Each run stores a configuration snapshot and durable identity. A dedicated PostgreSQL session advisory lock allows one active worker; process exit or connection loss releases it. Queue/import transaction locks and unique keys protect concurrent triggers and publication. Once collection has been saved, recovery reuses the durable payload and import identity. Personal job status, notes, next actions and application metadata are never reset on re-import.

After bounded request retries, successful sources publish together even if others fail. Today shows incomplete coverage and the affected companies. All sources failing creates a failed run and retains the previous successful recommendations. A successful collection with zero matches reports that result; the historical Board is retained. A retry is a new run using the current settings.

Run summaries, observation/dedup state and nonterminal recovery material remain durable. Raw collector snapshots under the files volume are eligible for cleanup after 30 days; completed run summaries and application history are not deleted. There is no Redis or separate queue to operate. Health checks report database/web availability and worker liveness; `unhealthy` containers should be inspected with `logs` (Docker does not automatically restart a merely unhealthy process).

## Upgrade

1. Make a complete backup (below).
2. Stop writers: `scripts/selfhost/compose.sh stop web worker`.
3. Update this checkout to the desired reviewed version.
4. Run `scripts/selfhost/compose.sh up -d --build --wait`.

If upgrading from a version that used a different environment filename, move your existing deployment configuration to `.env` before running the updated helper. Preserve the database password, project name and port; do not replace an existing installation's configuration with the example file.

The one-shot migration service runs before web/worker. Persistent volumes and web settings are reused. A migration failure prevents new application services starting; inspect migration logs before retrying. Do not assume downgrading an image rolls back a database migration: restore the complete backup into a fresh project if rollback is needed.

## Complete backup

```sh
scripts/selfhost/backup.sh /absolute/path/to/new-backup-directory
```

The script briefly stops web and worker, uses PostgreSQL's custom-format dump, archives the entire files volume, saves the deployment environment as `.env` alongside the image list, then restores the prior running/stopped state of each service. Only a finished backup gets a `COMPLETE` marker. The directory is private and includes resume contents, job history, account/session data and model/database credentials; store it as private personal data. The JSON export in the UI is a useful business-data export, not a substitute for this backup.

The matching checkout/image must also be retained for reproducible rollback. The script records image IDs, but does not export images.

## Restore into a fresh instance

Use a fresh checkout of the version you want to restore. Copy the backup's `.env` into that checkout:

```sh
cp /absolute/path/to/backup-directory/.env .env
```

In this new `.env`, set a new `COMPOSE_PROJECT_NAME` (for example `jobboard-restored`) and a free `JOBBOARD_PORT`. Retain the backup's PostgreSQL password. Build images for the checked-out version, then restore:

```sh
scripts/selfhost/compose.sh build
scripts/selfhost/restore.sh /absolute/path/to/backup-directory
```

Older backups stored the configuration as `deployment.env`; copy that file to `.env` instead. Their database and files archives remain compatible.

Restore refuses a nonempty database or files volume. It starts only the new database, restores both stores, then applies pending migrations and starts the app. Log in with the restored administrator account. Verify settings, confirmed resume download and a known application with notes. The original instance remains separate and can be stopped later if you choose to switch.

## Development isolation

Implementation/acceptance use `/Users/isaaczhu/JobBoard-self-hosted`, branch `feature/docker-self-hosting`, Compose project `jobboard-selfhost-dev`, port 3017 and dedicated volumes. The original `/Users/isaaczhu/JobBoard` main checkout, scheduled task, LaunchAgents, Vault and production database are not part of these commands or this release. See `specs/004-docker-self-hosting/validation.md` for the actual validation evidence and limitations.

## Test the implementation in Docker

Use a disposable `.env` with `COMPOSE_PROJECT_NAME=jobboard-selfhost-dev` and port 3017. The test override creates a separate in-memory PostgreSQL database; it does not use the web instance database.

```sh
docker compose --env-file .env -f compose.selfhost.yml -f compose.selfhost.test.yml --profile test run --build --rm tests
```

The gated `scripts/selfhost/check-http.mjs` also exercises the running isolated web API. It requires `JOBBOARD_ACCEPTANCE_TESTS=1`, an explicit `--target http://localhost:3017`, `TEST_ADMIN_EMAIL` and `TEST_ADMIN_PASSWORD`; inspect its usage before running because it creates test-only resume/job records. For complete fault/rebuild/restore evidence, see the validation report.
