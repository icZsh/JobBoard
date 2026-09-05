# Independent ATS collector quickstart

This feature lives in `/Users/isaaczhu/JobBoard-ats-collector` on `feature/ats-collector`. It does not replace the current Codex daily task, vault exports, import LaunchAgent or active JobBoard. No scheduler has been installed.

## Collect and review

From this worktree, with Node 22:

```sh
npm ci
npm run collector:collect
```

The collector does not need a running app, database, API key, resume file or LinkedIn login. `npm ci` generates the existing Prisma enum module used by the shared import validator; collection does not open a database connection or load the app's `.env`.

The printed run directory under `.collector-output/runs/` contains:

- `review.md`: shortlist, reasons, concerns, source status and counts.
- `payload.json`: one combined daily import payload, marked `ats_collector_rules_v1`.
- `report.json`: source errors, exclusions, counts, completeness and exact payload hash.
- `snapshot.json`: every normalized posting with its full description and rule decision.
- `config.json`: the exact configuration used, for reproducibility.

`.collector-output/state.json` separately tracks first seen, last seen, last checked and missing feed membership for stable ATS IDs. Missing membership does not confirm closure and never modifies personal tracking. A failed source preserves its previous observations. A later successful observation clears the missing marker.

Exit codes: `0` complete collection (possibly zero matches), `2` partial source failure with diagnostics, `1` invalid configuration or local execution failure. Empty or partial batches cannot be submitted by the import command. Unknown dates remain unknown; last-published/created timestamps are explicitly labeled and never presented as verified first publication. Full salary/benefit wording remains in the original role description when structured annual USD base pay is unavailable.

## Edit targeting

- `config/collector/sources.json`: 18 historical companies, provider/board/company/homepage/enabled. To add a company, use its real public ATS board slug. Disable a source with `enabled: false`.
- `config/collector/rules.json`: title patterns, location patterns, skill list, experience/freshness/salary preferences, minimum score and shortlist limit. Patterns are JavaScript regex source strings; all configuration is validated before requests.
- `config/collector/request.json`: read timeout, bounded retries and source concurrency.

The beginning set is **Adonis, OpenAI, Imprint, Luma, Minerva, Notion, Ramp, Decagon, Vercel, Grüns, Mill, Figma, Anthropic, Chime, Airtable, Gopuff, Gridware and Spotify**. The first eight use Ashby, the next seven Greenhouse, and the last three Lever. Slugs and available homepages were extracted from the latest matching entries in the historical `Jobs/2026/*/* Job List.json` archives; missing homepages remain null. Selection combines prior data/platform fit with coverage of all three provider adapters. It is a starting list, not global company discovery.

Rule scores describe keyword/location/freshness/compensation matching against editable preferences, not model judgment or a fresh resume assessment. Unknown or borderline facts are visible in concerns. The collector does not infer candidate skill gaps, employer benefits or company overviews. Only explicit supported salary currency/period semantics populate numeric fields.

Alternate output/config or an explicit screening date:

```sh
npm run collector:collect -- --config-dir config/collector --output .collector-output --date 2026-09-05
```

The default calendar date uses America/Los_Angeles. An explicit date changes screening and the daily label, not the current observation timestamp. Writes use an output lock and atomic replacement. If a crashed process leaves `.collection.lock`, verify no collector is running before removing that lock; do not delete state.json to clear a lock.

## Explicit import into an isolated app

Collection never sends a POST. The separate command requires a complete, nonempty run and an explicit loopback target. For example, after starting an isolated JobBoard backed by its own test database on port 3001:

```sh
npm run collector:import -- --run-dir .collector-output/runs/RUN_DIRECTORY --url http://127.0.0.1:3001/api/import-jobs
```

Do not point the preview at the currently active JobBoard while comparing workflows. The payload follows the existing API contract and includes all sources in one batch so Today receives the complete shortlist. Existing personal tracking is preserved by the unchanged importer.

The command validates the report's completeness and payload hash, then records endpoint+payload identity under the run's `import-state/`. Repeating a successful submission to the same endpoint skips the POST and returns its saved response. A failed or ambiguous request retains a pending marker and blocks automatic retry. If that happens, inspect the target app's import history and saved state before deciding whether it actually imported. Only after confirming no import occurred should the corresponding pending marker be removed to permit another attempt. A copied run directory without its state loses this client-side duplicate protection; server-side exactly-once delivery is outside this version.

Ashby and Lever use the official response's application URL when provided, which aligns with historical daily recommendations. When an employer has changed hosts or historical records used a different URL, review deduplication before any production rollout: the unchanged importer treats distinct URL keys as distinct openings. This collector does not migrate historical links.

## Optional scheduling example

`scripts/collector/launchd.example.plist` is a non-installed example with placeholder absolute paths and a distinct label. It runs collection only at 10:00 local time and never imports. Before any later activation, replace its paths, create the output directory, and review one manual run. Installing or activating it is intentionally outside this implementation. Leave the existing daily-task/import agents in place.

## Validation

```sh
npm run test:collector
npm run typecheck
npm run lint
npm run build
```

Collector tests mock HTTP and write to temporary directories. The full `npm test` suite includes database mutations, so run it only with `.env` pointing to an isolated test database. Live smoke checks perform GETs against public feeds and write only local artifacts.

The implementation validation record is in `validation.md` beside this guide.
