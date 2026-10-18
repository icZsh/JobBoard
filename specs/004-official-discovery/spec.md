# Official ATS discovery and a persistent candidate pool

Isaac approved prioritizing direct employer scans and a reusable candidate pool after the October 15 shortlist contained two first-time recommendations and eight repeats.

- Fetch public published jobs from an evidence-backed registry of Ashby, Greenhouse and Lever employer boards, seeded from existing recommendation links. Keep unsupported careers pages in the manual discovery workflow.
- Track stable posting identity, first seen, last seen, availability and the provider's publication signal separately. First discovery is never reported as the original posting date; republished timestamps never create a new requisition.
- Keep public discovery data outside the application database. Never create recommendations, change tracking or send applications from the scanner.
- Persist relevant roles across runs; apply broad role/location/level screening and current recommendation/application history to produce a review queue. The queue is not a verified shortlist or a fit score. Uncertain requirements require review, and applied/closed roles cannot be promoted by scoring.
- Only mark a posting missing after a successful complete fetch of its board. A failed, malformed or incomplete response preserves prior state and cannot supply fresh candidates from that board.
- New-to-recommendation-history roles precede repeats. Keep discovery, history-new and newly-published counts distinct.
- Integrate via the existing launchd import handoff, with bounded requests, concurrency, a once-per-local-date cache and explicit failure reporting. No new scheduler or JobBoard restart is necessary.
- The daily generator reads the candidate queue before open-ended search, verifies final postings and benefits, expands company coverage through additional searches, and still uses the existing history filter before import. Never promise ten brand-new suitable jobs per day.
- Report board successes/failures, retrieved jobs, first discoveries, relevant jobs, exclusions/holds, and first-time recommendation candidates. Initial population is a baseline, not thousands of newly posted jobs.

Acceptance: realistic provider fixtures; stable identity on link variants; incremental scans preserve first_seen; complete disappearance vs failed fetch differ; stale/missing history blocks queue creation; applied aliases excluded; remote outside the US and senior roles excluded/held appropriately; cached scan can regenerate tracking eligibility without network; one real scan and unchanged re-run verified before activation.
