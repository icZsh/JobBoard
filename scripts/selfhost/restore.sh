#!/bin/sh
# Restore only into an empty target project: this never overwrites an existing DB.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose=$repo/scripts/selfhost/compose.sh
backup=${1:?Usage: restore.sh /absolute/path/to/backup}
test -f "$backup/COMPLETE"
test -s "$backup/database.dump"
test -s "$backup/files.tar.gz"
"$compose" up -d --wait db
tables=$("$compose" exec -T db psql -U jobboard -d jobboard -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$tables" != "0" ]; then
  echo "Restore requires an empty database. Use a new Compose project name." >&2
  exit 1
fi
"$compose" run --rm --no-deps -T --entrypoint node web -e 'const fs=require("node:fs");if(fs.readdirSync("/app/data").length){console.error("Restore requires an empty files volume.");process.exit(1)}'
"$compose" exec -T db pg_restore -U jobboard -d jobboard --no-owner --no-privileges --exit-on-error < "$backup/database.dump"
"$compose" run --rm --no-deps -T --entrypoint tar web -C /app/data -xzf - --no-same-owner < "$backup/files.tar.gz"
"$compose" up -d --wait
echo "Restore complete; migrations applied and services started."
