# JobBoard

Your private job search dashboard: collect openings from company career boards, get a shortlist based on your preferences, and track applications in one place.

JobBoard collects from **Ashby, Greenhouse and Lever**, starting with 18 editable company templates. It filters and scores jobs using configurable rules, then saves recommendations to **Today** and your application **Board**. The current search settings target US jobs, including US remote roles.

**Run it with Docker and finish setup in your browser.** Automatic collection, scoring and tracking work without Codex, scheduled tasks in another app, host Node/Python, a resume or an AI API key. Gemini is optional for resume tailoring.

[Quick start](#quick-start) · [First collection](#set-up-your-search-and-collect-jobs) · [Troubleshooting](#troubleshooting) · [Backup and upgrade guide](SELF_HOSTING.md)

![Today showing collection results, source coverage, and recommended jobs](docs/images/today.jpg)

*The English-language UI shown here uses public job listings and a demo account with illustrative application statuses. No personal user data is shown.*

## Quick start

You need Docker running on your computer: Docker Desktop, or Docker Engine with the Compose and Buildx plugins. The first build downloads images and packages and may take several minutes. Collection also needs an internet connection to the selected company boards.

The installation supports Intel/AMD (`amd64`) and Apple Silicon/ARM (`arm64`). On Windows, run these commands in WSL with Docker integration enabled.

### 1. Get this version

The self-hosting feature is on `feature/docker-self-hosting`:

```sh
git clone --branch feature/docker-self-hosting --single-branch https://github.com/icZsh/JobBoard.git
cd JobBoard
```

Without Git, [download this branch as a ZIP](https://github.com/icZsh/JobBoard/archive/refs/heads/feature/docker-self-hosting.zip), extract it, and open a terminal in the extracted folder. Run the remaining commands there.

### 2. Set the database password

```sh
cp .env.example .env
```

Open `.env` in a text editor and replace `POSTGRES_PASSWORD` with a long random password using letters, numbers, `-` and `_` (24 or more characters recommended). This is the database password; you will create your separate login password in the browser.

| Setting | What to do |
| --- | --- |
| `POSTGRES_PASSWORD` | Replace the placeholder before starting. |
| `JOBBOARD_PORT` | Keep `3010`, or choose another free port. |
| `COMPOSE_PROJECT_NAME` | Keep `jobboard-selfhost`. Keep this name unchanged when restarting or upgrading so Docker reuses your data volumes. |
| `GEMINI_API_KEY` | Leave empty to start. Only needed for optional resume tailoring. |

Job preferences, company sources and your timezone are configured in the browser, not in this file.

### 3. Start JobBoard

```sh
docker compose --env-file .env -f compose.selfhost.yml up -d --build --wait
```

Open **[http://localhost:3010](http://localhost:3010)**, using your chosen port if you changed it. You should see **Set up your search**.

Docker starts PostgreSQL, applies database migrations, then starts the web app and collection worker. No manual database setup, seed command or separate scheduler is needed. This Compose file is the complete installation; the original `docker-compose.yml` is for local development and should not be combined with it.

The web app is available only on the computer running Docker (`localhost`); the database has no exposed host port. This release is for one private administrator, with no public registration or public hosting setup.

## Set up your search and collect jobs

1. **Create your administrator account.** Use an email and a password of 12–256 characters. Setup closes after this account is created; future visits use the login page.
2. **Review the search preferences.** The starter settings target data/analytics engineering roles. Replace the role phrases, excluded title words, cities, skills, experience, salary and job-age preferences with your own. Enter one item per line in text lists. Select at least one US city or enable US remote jobs.
3. **Choose the schedule.** Check the browser-detected timezone and daily time, which defaults to **09:00**. Leave automatic collection enabled, or uncheck it to start with manual runs only.
4. **Review Company sources.** Expand the section to enable, remove or add companies. Keep at least one enabled. Only these companies are searched.
5. Click **Create account and save preferences**, then **Collect jobs now** on Settings. Today shows the run progress, source coverage and resulting shortlist. You can also start a run with **Run now** on Today.

<details>
<summary>Preview first-time setup</summary>

![First-time setup with administrator account fields and search preferences](docs/images/setup.jpg)

Create your account and review the starter preferences before your first collection.

</details>

You can close the browser while collection runs. Keep Docker running and the host computer awake for scheduled collection. After downtime, the worker catches up on at most the most recent missed daily run.

Salary and preferred minimum experience affect scoring; jobs above the maximum required experience are excluded. Missing source details are flagged for review. Scores reflect your saved preferences, not an AI assessment of your resume.

### Add a company

In **Settings → Company sources → Add company**, enter its name and company-wide ATS board URL, then click **Save preferences**. Supported URL shapes are:

| Provider | Board URL format |
| --- | --- |
| Ashby | `https://jobs.ashbyhq.com/COMPANY` |
| Greenhouse | `https://job-boards.greenhouse.io/COMPANY` or `https://boards.greenhouse.io/COMPANY` |
| Lever | `https://jobs.lever.co/COMPANY` |

Replace `COMPANY` with the company's actual board identifier. Use the board homepage without query parameters or a fragment. A company marketing site, individual job link, LinkedIn page or Workday URL is not supported.

<details>
<summary>Preview the schedule and company sources</summary>

![Settings showing a 09:00 daily schedule in America/New_York and the first company board URLs](docs/images/settings.jpg)

Choose your timezone and daily time, then enable or edit company sources.

</details>

### Optional: upload a resume and enable tailoring

Open **Settings → Resume**, upload a PDF, DOCX, Markdown or TXT file (up to 10 MB), review and edit the extracted text, then confirm it. Uploading alone does not activate the resume. Scanned PDFs need text supplied separately; OCR is not included. Invalid uploads leave the current confirmed resume in place.

To enable tailoring, add your `GEMINI_API_KEY` to `.env`, then apply it:

```sh
docker compose --env-file .env -f compose.selfhost.yml up -d --wait web
```

When you request tailoring for a job, the confirmed resume and job context are sent to Gemini. Generated resumes are available as Markdown downloads. The API key and a confirmed resume are both required for this feature; collection and tracking work independently.

## Day-to-day use

| Where | What you can do |
| --- | --- |
| **Today** | Review the latest shortlist, see source failures and the next scheduled run, or run/retry collection. |
| **Board** | Track applications, update statuses and keep notes. Later collections preserve this information. |
| **Settings** | Edit preferences and companies. Click **Save preferences** before collecting; queued/running jobs keep their original settings. |
| **Settings → Resume** | Upload, review, confirm and download managed resume files. |

![Review flow changing a job from New to Interested on Today, then finding it on Board](docs/images/review-to-board.gif)

*Mark a job Interested on Today, then continue tracking it on Board.*

<details>
<summary>View the application Board</summary>

![Board showing jobs with example application statuses](docs/images/board.jpg)

Example follow-up statuses on the application Board.

</details>

To pause the daily schedule, uncheck **Collect new jobs automatically each day** and save. This stops new scheduled runs; an existing queued/running collection can finish, and manual collection remains available.

If some sources fail, results from successful sources are published with a partial-coverage message. If all sources fail or no jobs match, Today explains the outcome and preserves earlier recommendations and your Board.

## Stop, restart and protect your data

Run these from the project folder:

```sh
# Check services; migrate exiting with code 0 is expected.
docker compose --env-file .env -f compose.selfhost.yml ps -a

# Inspect recent application and startup logs.
docker compose --env-file .env -f compose.selfhost.yml logs --tail=100 web worker migrate

# Stop the installation, keeping its data.
docker compose --env-file .env -f compose.selfhost.yml stop

# Start it again with the same configuration and volumes.
docker compose --env-file .env -f compose.selfhost.yml up -d --wait
```

The database volume stores your account, settings, run history and application data. The files volume stores resumes and collection artifacts. Both survive container rebuilds; deleting volumes with `down -v` deletes that data. Completed raw collection snapshots are kept for 30 days by default, while run summaries and application history remain.

For a complete backup on macOS/Linux or WSL:

```sh
scripts/selfhost/backup.sh
```

The helper briefly stops web and worker, writes a dated directory under `backups/`, and restores their prior running state. Copy completed backups somewhere private outside this checkout. They contain account data, resumes and deployment credentials. The UI's job-data export is not a complete backup.

Before updating the checkout or rebuilding for a new version, follow the [upgrade procedure](SELF_HOSTING.md#upgrade). See the [full backup](SELF_HOSTING.md#complete-backup) and [restore instructions](SELF_HOSTING.md#restore-into-a-fresh-instance) for moving to another computer or recovering an installation.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Docker cannot connect, or `compose` / `buildx` is missing | Start Docker Desktop, or enable the required plugins for Docker Engine. On Windows, check WSL integration. |
| Startup reports that port 3010 is in use | Set a free `JOBBOARD_PORT` in `.env`, run the start command again, and open the new port. |
| The page does not open or startup fails | Run `ps -a` and the logs command above. `db`, `web` and `worker` should be running; `migrate` should have exited with code 0. For database errors, also inspect `logs --tail=100 db`. |
| Login appears instead of first setup | This Compose project already has an account in its data volume. Sign in with that account. A separate installation needs its own project name and port. |
| A collection remains queued | Check the worker logs and that Docker is running. Closing the browser does not stop the worker. |
| No jobs match | Check role phrases, excluded title words, cities/remote preference, maximum experience and posting age. Save changes before clicking **Run now**. Review source coverage to distinguish no matches from failed sources. |
| A company source fails | Confirm its supported board URL still exists. Retry from Today; a removed or renamed board must be updated in Settings. |
| Resume tailoring is disabled | Confirm a resume, set `GEMINI_API_KEY`, then recreate web with the command above. |

## Development and further reading

- [Self-hosting operations](SELF_HOSTING.md): scheduling behavior, recovery, upgrades, backups, restores and isolated Docker tests.
- [Feature specification](specs/004-docker-self-hosting/spec.md) and [validation record](specs/004-docker-self-hosting/validation.md).
- [Product requirements](PRD.md) and [application contracts](SPEC.md).

The stack is Next.js, TypeScript, Prisma and PostgreSQL, with a separate Node worker. For source checks, use Node 22. The build command uses the same database URL placeholder as Docker; it requires no running database.

```sh
npm ci
npm run lint
npm run typecheck
DATABASE_URL=postgresql://build:build@127.0.0.1:1/build npm run build
npm run build:worker
```

Use the [isolated Docker test procedure](SELF_HOSTING.md#test-the-implementation-in-docker) for database integration tests. The standalone `npm run collector:collect` command is also available for generating local review artifacts, but is not needed for the Docker workflow.
