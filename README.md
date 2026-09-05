# Personal Job Tracker

A local-only web application for importing daily job recommendations, reviewing high-fit roles, and tracking applications.

## Docker self-hosting

For a private installation with web setup, automatic ATS collection and optional resume uploads, follow [SELF_HOSTING.md](SELF_HOSTING.md). Start with `compose.selfhost.yml`; it is independent of the original local startup configuration below. No Codex, launchd or host Node/Python is required to run the Docker installation.

An optional independent ATS collector is documented in [the collector quickstart](specs/003-ats-collector/quickstart.md). `npm run collector:collect` generates local review artifacts from 18 configured company boards; it does not import jobs or change existing scheduled tasks.

## Current Status

The app implements daily review, a persistent application Board, imports, tracking, single-admin setup, Docker collection and managed resumes. Product and implementation contracts live in:

- `PRD.md`
- `SPEC.md`
- `BUILD_TODOS.md`

## Development

Install dependencies:

```bash
npm install
```

Create local environment variables:

```bash
cp .env.example .env
```

Run the development server:

```bash
npm run dev
```

Run checks:

```bash
npm run lint
npm run typecheck
npm run build
```

Open [http://localhost:3000](http://localhost:3000) after starting the dev server.

## Database

The app expects a local Postgres database. If Docker is available, start the included service:

```bash
docker compose up -d db
```

Then apply migrations and seed initial settings:

```bash
npm run db:migrate
npm run db:seed
```

If Docker is not available, run any local Postgres instance and update `DATABASE_URL` in `.env`.

## Build Flow

Work through `BUILD_TODOS.md` one item at a time. Each completed item should be committed before moving to the next one.
