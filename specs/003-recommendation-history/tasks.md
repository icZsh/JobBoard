# Tasks

- [x] Reproduce applied jobs and repeated recommendations using live export and daily archives.
- [x] Document requested policy and implementation contract.
- [x] Implement and test shared eligibility and Today review behavior.
- [x] Implement and test sanitized history snapshot and pre-import filtering.
- [x] Update daily search automation, local import handoff, and durable rubric.
- [x] Run regression suite, typecheck, lint, build, and October 14 replay: 69 tests pass; production preview excludes 5 applied and 3 recent repeats, hidden review retains all 8, Board retains all 393 jobs.
- [x] Activate after Isaac's restart approval and verify live runtime: service running, 0 default recommendations / 8 explicit hidden-review rows, all 393 jobs and tracking status/application dates preserved. Previous build retained for rollback.
- [x] Record Isaac's correction: target about ten useful jobs daily and backfill today; an empty board is not the intended outcome.
- [x] Replace hard repeat cooldown/quota with fresh-first top-ten ranking and strong evidenced repeat fallback; update focused tests before implementation.
- [x] Restore original rows for past dates as plain dated lists, with current tracking and no history labels or Apply Today badges/count; cover applied/repeated older rows in a render test.
- [x] Update discovery automation, durable rubric and history-filter explanations to the corrected target-ten policy.
- [x] Verify and import ten unseen active jobs for October 14 (eight published within 30 days, two older active strong fits with explicit caveats); original daily files backed up.
- [x] Validate corrected policy: 72 tests, typecheck, lint and production build pass. Activate using Isaac's earlier restart approval.
- [x] Verify live October 8–14 views show 12, 11, 12, 12, 8, 8 and 10 cards respectively; past six dates show their original jobs without Apply Today prompts. Import created ten jobs, zero updates; all 394 pre-existing tracking records are exactly preserved.
- [x] Document Isaac's preference for plain older-date lists without history banners, History badges, or Historical review labels; preserve data, tracking controls, and date-specific filtering behavior.
- [x] Confirm active daily 9 AM automation retains schedule/model and now targets ten with broader discovery and strong-repeat fallback.

- [x] Remove older-date history notice/header/badges and use Suggested Action consistently. All 72 tests, typecheck, lint and build pass; activated and verified all seven live date views retain their rows without history labels.
