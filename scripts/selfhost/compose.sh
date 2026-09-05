#!/bin/sh
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
env_file=${JOBBOARD_ENV_FILE:-$repo/.env.selfhost}
exec docker compose --env-file "$env_file" -f "$repo/compose.selfhost.yml" "$@"
