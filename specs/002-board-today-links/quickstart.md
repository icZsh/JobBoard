# Quickstart: Today Links to Posting Detail

## Prerequisites

- JobBoard dependencies installed.
- Local `.env` configured with `DATABASE_URL` for the existing local JobBoard database.
- At least one successful import run so `/today` has visible jobs and `/jobs/<id>` detail pages exist.

## Automated validation

Run from repository root:

```bash
npm run test -- tests/job-links.test.ts
npm run typecheck
npm run lint
npm run build
```

Expected results:

- Link helper tests pass and prove stable posting detail URL generation.
- TypeScript accepts the Today UI change.
- Lint reports no new issues.
- Production build completes.

## Manual validation

1. Start or restart JobBoard using the existing local runtime flow.
2. Open `/today`.
3. Confirm each job title appears as a link while the existing `Details`, quick status actions, `Apply`, and resume-tailoring controls remain available.
4. Click a job title.
5. Confirm a new tab opens `/jobs/<job-id>` and shows that posting's detail page.
6. Confirm the new tab does **not** land on `/board`.
7. In the original Today tab, confirm filters/sort/detail expansion context remains intact.

## Non-goals

- Do not change database schema, import logic, or tracking persistence.
- Do not replace the external Apply/source listing link.
- Do not add a new Board pipeline deep-link mechanism for this corrected behavior.
