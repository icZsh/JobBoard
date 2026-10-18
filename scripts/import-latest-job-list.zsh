#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export TZ="America/Los_Angeles"

jobs_root="/Users/isaaczhu/Isaac's Vault/Jobs"
state_dir="/Users/isaaczhu/.codex/automations/daily-data-job-shortlist/import-state"
jobboard_root="/Users/isaaczhu/JobBoard"
history_path="$state_dir/recommendation-history.json"

dry_run=0
mark_imported=0
discover_only=0
run_date="${RUN_DATE:-$(date +%F)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=1
      shift
      ;;
    --discover-only)
      discover_only=1
      shift
      ;;
    --mark-imported)
      mark_imported=1
      shift
      ;;
    --date)
      run_date="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

year="${run_date%%-*}"
month_day="${run_date#*-}"
month="${month_day%%-*}"
json_path="$jobs_root/$year/$month/$run_date Job List.json"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S %Z'
}

log() {
  echo "[$(timestamp)] $*"
}

mkdir -p "$state_dir"

# Kernel-owned lock: SIGKILL or a crash releases it when the last holder exits.
# Keep the file itself in place; its existence is not evidence of a running owner.
exec 9>"$state_dir/import.lock"
if ! /usr/bin/lockf -s -t 0 9; then
  log "Another import check holds the lock; retry after it finishes."
  exit 75
fi
input_snapshot=""
trap '[[ -z "$input_snapshot" ]] || rm -f "$input_snapshot"' EXIT

# Runs before the missing-file/unchanged-file checks so the scheduled search can
# request fresh history through launchd without network access of its own.
cd "$jobboard_root"
"$jobboard_root/node_modules/.bin/tsx" "$jobboard_root/scripts/recommendation-history.ts" \
  snapshot --output "$history_path"


# The existing handoff also prepares a persistent official-source candidate pool.
# Requests run here under launchd because the scheduled agent has no shell network.
# The scanner caches a completed scan for this local date and always rechecks tracking.
discovery_dir="/Users/isaaczhu/.codex/automations/daily-data-job-shortlist/discovery-state"
discovery_registry="$discovery_dir/sources.json"
discovery_status=0
if node --import tsx "$jobboard_root/scripts/discover-jobs.ts" seed \
    --history "$history_path" --registry "$discovery_registry" && \
   node --import tsx "$jobboard_root/scripts/discover-jobs.ts" scan \
    --history "$history_path" --registry "$discovery_registry" \
    --state-dir "$discovery_dir" --date "$run_date"; then
  log "Official discovery queue refreshed: $discovery_dir/queue.json"
else
  discovery_status=1
  log "Official discovery failed; inspect discovery-state/status.json and use verified manual discovery."
fi
if [[ "$discover_only" -eq 1 ]]; then
  log "Discovery-only handoff complete; no recommendation import attempted."
  exit "$discovery_status"
fi

if [[ ! -f "$json_path" ]]; then
  log "No job list JSON for $run_date yet: $json_path"
  exit 0
fi

# Validate, hash, and filter one immutable source revision.
input_snapshot="$(mktemp "$state_dir/$run_date.input.XXXXXX")"
cp "$json_path" "$input_snapshot"
json_path="$input_snapshot"

node - "$json_path" "$run_date" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const runDate = process.argv[3];
const expectedJobKeys = [
  "title",
  "company",
  "company_website_url",
  "location",
  "remote_type",
  "salary_min",
  "salary_max",
  "source_url",
  "date_posted",
  "description",
  "fit_score",
  "priority",
  "matched_skills",
  "missing_skills",
  "match_reason",
  "concerns",
  "suggested_action",
];
const errors = [];
const optionalJobKeys = ["repeat_reason", "repeat_evidence_url"];
const payload = JSON.parse(fs.readFileSync(path, "utf8"));
if (payload.run_date !== runDate) errors.push(`run_date must be ${runDate}`);
if (payload.source_name !== "daily_data_job_shortlist") errors.push("source_name mismatch");
if (!Array.isArray(payload.jobs)) errors.push("jobs must be an array (empty is allowed)");
if (Array.isArray(payload.jobs)) {
  payload.jobs.forEach((job, index) => {
    const keys = Object.keys(job);
    for (const key of expectedJobKeys) {
      if (!(key in job)) errors.push(`job ${index} missing ${key}`);
    }
    for (const key of keys) {
      if (!expectedJobKeys.includes(key) && !optionalJobKeys.includes(key)) errors.push(`job ${index} has extra key ${key}`);
    }
    if (![null, "remote", "hybrid", "onsite"].includes(job.remote_type)) {
      errors.push(`job ${index} invalid remote_type`);
    }
    if (job.company_website_url !== null) {
      try {
        const companyWebsiteUrl = new URL(job.company_website_url);
        if (companyWebsiteUrl.protocol !== "https:") {
          errors.push(`job ${index} company_website_url must use HTTPS`);
        }
      } catch {
        errors.push(`job ${index} invalid company_website_url`);
      }
    }
    if (!["low", "medium", "high"].includes(job.priority)) {
      errors.push(`job ${index} invalid priority`);
    }
    if (!Number.isInteger(job.fit_score)) errors.push(`job ${index} invalid fit_score`);
    for (const salaryKey of ["salary_min", "salary_max"]) {
      if (job[salaryKey] !== null && !Number.isInteger(job[salaryKey])) {
        errors.push(`job ${index} invalid ${salaryKey}`);
      }
    }
    if (job.date_posted !== null && !/^\d{4}-\d{2}-\d{2}$/.test(job.date_posted)) {
      errors.push(`job ${index} invalid date_posted`);
    }
    if (!Array.isArray(job.matched_skills) || !Array.isArray(job.missing_skills)) {
      errors.push(`job ${index} invalid skill arrays`);
    }
  });
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
NODE

# This coordinator re-exports tracking after discovery, checks same-day server
# runs, reserves a durable attempt, and reconciles uncertain responses without
# retrying POST. Its import-history snapshot is separate from discovery history.
import_args=(--input "$json_path" --state-dir "$state_dir" --date "$run_date")
if [[ "$dry_run" -eq 1 ]]; then
  import_args+=(--dry-run)
fi
if [[ "$mark_imported" -eq 1 ]]; then
  import_args+=(--mark-imported)
fi
"$jobboard_root/node_modules/.bin/tsx" "$jobboard_root/scripts/import-daily-shortlist.ts" "${import_args[@]}"
