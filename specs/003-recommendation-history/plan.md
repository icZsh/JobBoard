# Implementation plan

Use a pure shared recommendation selector in Today and a local CLI that sanitizes the existing export and filters daily import payloads. Keep optional repeat evidence in raw recommendation JSON, avoiding a schema migration. Update the existing scheduled search prompt, screening rubric, and launchd import wrapper.

Constitution check: local data only; tracking is read-only for filtering; product contracts updated; behavior tests precede implementation; no paid-model calls, new service, or table. Validate tests, typecheck, lint, and build. Any restart follows the repository's runtime confirmation requirement.

Verification: exercise the real October 14 export, regression cases for status and ATS identity, fresh-first ranking, filling shortages to ten with evidenced repeats, fit/recency ordering, empty import validation, and Today rendering. The scheduled generator must be able to read the snapshot without loopback network access. The prior hard cooldown and repeat percentage cap are removed following Isaac's clarification; application exclusions remain absolute.
