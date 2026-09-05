# Validation record — 2026-09-05

## Automated checks

- `npm test`: 83 tests passed, no failures or skipped tests, including 43 collector tests.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed (Next.js 16.2.6).
- `plutil -lint scripts/collector/launchd.example.plist`: passed; the example was not installed.
- Independent review caught and fixed fractional/unsafe salary values incompatible with the importer, and use of posting URLs where the provider exposes the historical application URL.
- Rule review added regressions for engineering-title boundaries, required/preferred experience grammar, US remote eligibility, and preventing the existing Apply Today heuristic from misreading a review-only action.

## Read-only live collection

The original 18-source smoke run returned 17 successful feeds and a 404 for Whatnot's historical Ashby board. The report correctly marked the collection partial; no import was attempted. Whatnot was replaced with Decagon, another historical recommendation company with a working public feed.

The final run successfully fetched all 18 configured feeds and observed **3,115 unique postings**, of which **13 passed the rules** and the top **12** formed the combined shortlist. The resulting payload passed the existing importer schema. Final artifacts remain locally at:

`/Users/isaaczhu/JobBoard-ats-collector/.collector-output/runs/2026-09-05T19-32-52.190Z-a480c5eb/`

The ignored output directory also retains the earlier partial-run diagnostics and independent observation ledger. Results are a point-in-time snapshot, not a claim that future requests return the same openings.

## Isolated end-to-end import

A dedicated temporary PostgreSQL cluster used port 55439 and database `collector_test`. Existing migrations and integration tests ran against it. An isolated Next.js instance used port 3017 and that test database; it never used the active JobBoard database.

The explicit import CLI submitted the final 12-job batch successfully. Repeating the same command returned `already-imported` without another POST. Direct database verification showed **1 import run, 12 jobs, and 12 recommendations**. The test app and temporary database were stopped and cleaned up afterward. Saved submission markers refer only to that disposable test endpoint.

## Existing workflow

The original checkout `/Users/isaaczhu/JobBoard` remains on `main` with no working-tree changes. No existing Codex scheduled task, LaunchAgent, vault daily-list file, app service, or production database was changed. The new scheduler remains an uninstalled collection-only example. Production activation and historical URL migration are outside this worktree implementation.
