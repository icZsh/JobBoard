# Personal Job Tracker

A local-only web application for importing daily job recommendations, reviewing high-fit roles, and tracking applications.

An optional independent ATS collector is documented in [the collector quickstart](specs/003-ats-collector/quickstart.md). `npm run collector:collect` generates local review artifacts from 18 configured company boards; it does not import jobs or change existing scheduled tasks.

## Current Status

The project currently has the base Next.js, TypeScript, Tailwind, ESLint, Prisma, and Postgres schema scaffold in place. The product and implementation contract lives in:

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
