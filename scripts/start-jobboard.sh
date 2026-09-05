#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "/Users/isaaczhu/JobBoard"

if ! /opt/homebrew/bin/docker info >/dev/null 2>&1; then
  docker_context=$(/opt/homebrew/bin/docker context show 2>/dev/null || true)

  if [[ "$docker_context" == "colima" ]] && command -v /opt/homebrew/bin/colima >/dev/null 2>&1; then
    /opt/homebrew/bin/colima start
  fi
fi

if ! /opt/homebrew/bin/docker info >/dev/null 2>&1; then
  /usr/bin/open -ga Docker >/dev/null 2>&1 || true

  for _ in {1..60}; do
    if /opt/homebrew/bin/docker info >/dev/null 2>&1; then
      break
    fi

    sleep 2
  done
fi

/opt/homebrew/bin/docker compose up -d db

for _ in {1..30}; do
  db_status=$(/opt/homebrew/bin/docker inspect -f '{{.State.Health.Status}}' jobboard-postgres 2>/dev/null || true)
  if [[ "$db_status" == "healthy" ]]; then
    break
  fi

  sleep 1
done

exec /opt/homebrew/bin/npm run start:lan
