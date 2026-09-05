# Quickstart: Resume Tailoring Validation

## Prerequisites

- JobBoard dependencies installed.
- Local `.env` configured with `DATABASE_URL` and existing JobBoard settings.
- Settings page contains a Markdown/plain-text base resume path, preferably:

```text
/Users/isaaczhu/Isaac's Vault/Jobs/Resumes/Resume-Isaac Zhu.md
```

- Runtime environment includes:

```text
GEMINI_API_KEY="..."
GEMINI_RESUME_MODEL="gemini-3.1-pro"
TAILORED_RESUME_ROOT="/Users/isaaczhu/Isaac's Vault/Jobs/Resumes/Tailored"
```

`GOOGLE_API_KEY` may be accepted as fallback. Do not commit real keys.

## Automated Validation

Run focused tests during implementation as each unit is added:

```sh
npx tsx --env-file=.env --test --test-reporter=spec tests/resume-schema.test.ts
npx tsx --env-file=.env --test --test-reporter=spec tests/resume-output.test.ts
npx tsx --env-file=.env --test --test-reporter=spec tests/resume-input.test.ts
npx tsx --env-file=.env --test --test-reporter=spec tests/resume-tailor-service.test.ts
```

Then run broader checks:

```sh
npm run typecheck
npm run lint
npm run build
```

`npm run test` runs the configured full test glob and may require local Postgres/database state. If it fails for environment setup, capture the exact database prerequisite rather than hiding it.

## Manual Happy Path

1. Start JobBoard in the existing local dev/runtime flow.
2. Open a job detail page whose status is `Interested`, `Applying`, `Applied`, or `Interviewing`.
3. Confirm the tracking panel shows `Tailor resume`.
4. Click `Tailor resume`.
5. Confirm the button shows a generating state without blocking the whole page.
6. After success, confirm:
   - a Markdown file exists under `TAILORED_RESUME_ROOT/YYYY/MM/`;
   - the filename is readable and timestamped to seconds;
   - tracking panel shows updated resume path and version;
   - warnings/changes display if returned;
   - unrelated unsaved notes/next-action edits remain dirty if they were dirty before tailoring.

## Manual Failure Checks

### Missing base resume path

1. Clear the resume file path in Settings or use a test seam.
2. Trigger tailoring.
3. Expected: clear inline configuration error; no resume path/version mutation.

### PDF/non-text resume path

1. Configure a `.pdf`, `.docx`, image, or binary path as the base resume.
2. Trigger tailoring.
3. Expected: request is rejected before provider call; inline error says Markdown/plain text is required.

### Missing job context

1. Use a job with no description and no recommendation context.
2. Trigger tailoring.
3. Expected: clear context error; no file write; no tracking mutation.

### Provider invalid JSON

1. Use a mocked provider response with malformed JSON or missing `ok: true`.
2. Trigger the service or route test.
3. Expected: `GEMINI_INVALID_JSON` maps to a concise 502-style error; no file write or tracking mutation.

### Repeated clicks

1. Tailor the same job twice in quick succession.
2. Expected: second run creates a distinct file and does not overwrite the first.

## Runtime Restart Boundary

Do not restart the JobBoard LaunchAgent automatically. If implementation changes require restart to affect Isaac's running app, stop and ask Isaac first.
