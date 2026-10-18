# Recommendations that respect application history

Isaac reported that daily recommendations included jobs already applied to and too many prior recommendations. Applied jobs must be excluded, and repeated jobs need strong evidence. Isaac subsequently clarified that an empty board is unacceptable: target about ten useful recommendations daily and backfill the current day.

- Use current tracking as the application source of truth; do not infer application from a previous recommendation.
- Exclude any job with an application date, or Applying, Applied, Interviewing, Offer, Rejected, Passed, or Archived status, from default recommendations. Keep tracking and historical imports available on Board and explicit hidden review.
- Exhaust discovery for new requisitions first. A repeat requires fit at least 90, High priority, and a concrete reason with current HTTPS source evidence. A verified exceptionally close match in role, level, and stack qualifies without a changed posting.
- Select up to ten jobs: new eligible jobs ranked by fit first, then the strongest evidenced repeats. Rank repeats by fit, breaking ties in favor of the oldest latest recommendation. Seven days is a preference, not a mandatory cooldown; no fixed repeat quota may force an empty or short list. Never use applied or otherwise excluded jobs to fill the target.
- Match stable ATS identities across link variants, preserving distinct requisition IDs.
- The scheduled generator reads a fresh local history snapshot. The launchd importer refreshes history and enforces the same gate before import. Missing/stale history must block import rather than assume all candidates are new.
- Preserve all personal tracking fields. No database migration or history deletion.
- Dates before the latest successful run show all originally imported jobs, including applied and repeated rows, as plain dated lists. Keep the selected date and ordinary card wording; omit history banners, History badges, and Historical review labels. Show current tracking status and allow edits, but no Apply Today badge/count. Do not backdate new discoveries or modify archived payloads to fill past dates.

Acceptance: applied jobs in the October 14 baseline remain suppressed; ten fresh eligible roles outrank every repeat; a shortage is filled by sourced strong repeats including recently recommended roles; the selected list never exceeds ten; same-day reimports do not invent a prior-day repeat; no application or tracking history is changed by selection. Empty payloads remain valid at the API level, but the scheduled search must continue discovery/backfill toward ten useful recommendations.
