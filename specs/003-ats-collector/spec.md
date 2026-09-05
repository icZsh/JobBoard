# Independent ATS Collector

Branch: `feature/ats-collector` · Date: 2026-09-05

## Intent and scope

Build an independent TypeScript CLI that reads public Ashby, Greenhouse and Lever job boards, applies configurable deterministic screening, and emits one daily JobBoard-compatible shortlist plus a collection report. Start with 18 companies selected from Isaac's historical recommendations. No model calls in this version.

The existing Codex automation, LaunchAgents, vault exports, running app, database, and personal tracking remain untouched. Collection writes only to a dedicated output directory in this worktree by default. Scheduling is an uninstalled example; import is a separate explicit command with an explicit loopback URL and no default destination.

## User stories

1. Run the collector manually and inspect source-level success/failure, observed postings, exclusions and the scored shortlist without writing to JobBoard.
2. Edit the company list, target locations, title exclusions, skills, experience limits, freshness and shortlist size in JSON without changing code.
3. Rerun collection safely: deduplicate stable ATS identities, track first/last observation separately from provider dates, and report missing-from-feed only after a complete successful source fetch. Failure must not infer closure.
4. Explicitly import one combined nonempty, fully successful batch into a chosen test app. Repeated successful submissions of the same payload to the same endpoint are skipped; ambiguous POST outcomes are held for reconciliation rather than automatically retried.

## Acceptance criteria

- Three provider adapters consume public documented endpoints, include all pages, validate responses, and use bounded timeouts/retries for reads.
- Only publicly listed Ashby postings are included. Provider dates retain their meaning: first publication, last publication, creation, or unknown. Updates/observation dates never become original posting dates.
- Salary fields contain annual USD base salary only when explicitly represented as such; hourly/other currencies and ambiguous multi-tier values remain unknown or carry an explicit caveat.
- Rules reject irrelevant titles, unsuitable locations and clear seniority/contract exclusions; missing or ambiguous facts carry concerns. Scores and explanations explicitly identify rule matching, not resume/LLM judgment.
- An unknown posting date stays null, a future date is flagged, and a repost date is identified as such.
- Company and Benefits summaries never invent employer facts. The full plain-text role description is retained for review.
- Partial failures produce diagnostics and a nonzero exit, retaining successful evidence without pretending the complete set was checked.
- Import files pass the existing importer schema. All sources share a single batch so Today never receives a per-company fragment.
- No automatic production imports, scheduler installation, app restarts, database changes, or workflow replacement.

## Deferred

Global company discovery, LinkedIn scraping, Workday/custom websites, AI scoring, UI listing-status changes, production rollout, and server-side import idempotency.
