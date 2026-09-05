#!/bin/sh
# A consistent full backup requires pausing both writers until dump + files finish.
set -eu
umask 077
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose=$repo/scripts/selfhost/compose.sh
destination=${1:-$repo/backups/$(date -u +%Y%m%dT%H%M%SZ)}
if [ -e "$destination" ]; then
  echo "Backup destination already exists; choose a new directory." >&2
  exit 1
fi
mkdir -p "$destination"
destination=$(CDPATH= cd -- "$destination" && pwd)
web_was_running=false
worker_was_running=false
for service in $("$compose" ps --status running --services); do
  case "$service" in
    web) web_was_running=true ;;
    worker) worker_was_running=true ;;
  esac
done
resume_writers() {
  if [ "$web_was_running" = true ]; then "$compose" start web >/dev/null; fi
  if [ "$worker_was_running" = true ]; then "$compose" start worker >/dev/null; fi
}
trap resume_writers EXIT
"$compose" stop web worker
"$compose" exec -T db pg_dump -U jobboard -d jobboard --format=custom > "$destination/database.dump"
"$compose" run --rm --no-deps -T --entrypoint tar web -C /app/data -czf - . > "$destination/files.tar.gz"
cp "${JOBBOARD_ENV_FILE:-$repo/.env.selfhost}" "$destination/deployment.env"
"$compose" images --format json > "$destination/images.json"
printf '%s\n' 'JobBoard full backup v1' > "$destination/COMPLETE"
echo "Backup complete: $destination"
