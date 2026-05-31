# Build Todos

This project will be built in gated steps. After each item is completed, pause and ask Isaac for confirmation before continuing.

## Workflow

- Complete one item at a time.
- Commit meaningful checkpoints to git.
- Do not start the next item until Isaac confirms.
- Keep `PRD.md`, `SPEC.md`, and `CLAUDE.md` as the source of truth for scope and implementation details.

## Items

1. [ ] Initialize git repo and create build todo tracker.
2. [ ] Scaffold Next.js app and base tooling.
3. [ ] Add Prisma/Postgres schema and seed settings.
4. [ ] Implement import validation, dedupe helpers, and import API.
5. [ ] Build Today view with status quick actions.
6. [ ] Build tracking update flow, Board, and Job Detail.
7. [ ] Build Import, Settings, and Export flows.
8. [ ] Add focused tests and run verification.

## Notes

- The app is local-only and unauthenticated.
- Use Postgres, Prisma, Next.js, TypeScript, and Tailwind.
- Preserve raw payloads for accepted import requests.
- Preserve tracking state across repeated imports.
- Keep priority read-only from recommendations.
