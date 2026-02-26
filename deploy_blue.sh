#!/usr/bin/env bash
set -euo pipefail

echo "Starting blue deploy"

FRONTEND_PORT="${FRONTEND_PORT:-8180}"

wait_for_healthy() {
  local container="$1"
  local timeout_seconds="${2:-180}"
  local elapsed=0

  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{if .State.Running}}running{{else}}stopped{{end}}{{end}}' "$container" 2>/dev/null || true)"

    case "$status" in
      healthy|running)
        echo "${container} is ${status}"
        return 0
        ;;
      unhealthy|stopped|exited|dead)
        echo "${container} entered ${status} state."
        docker logs --tail 120 "$container" || true
        return 1
        ;;
    esac

    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "Timed out waiting for ${container} to become healthy."
  docker logs --tail 120 "$container" || true
  return 1
}

# Only frontend should be host-published through gateway.
clash="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "0\.0\.0\.0:${FRONTEND_PORT}->" || true)"
if [ -n "$clash" ] && ! echo "$clash" | grep -q "dailydb-gateway"; then
  echo "Port ${FRONTEND_PORT} is busy. Stop the container that binds it before running this script:"
  echo "$clash"
  exit 1
fi

# Bring up target stack first so nginx can resolve upstream names.
docker compose up -d backend-blue frontend-blue

wait_for_healthy dailydb-backend-blue
wait_for_healthy dailydb-frontend-blue

# Ensure gateway exists/runs.
docker compose up -d gateway
wait_for_healthy dailydb-gateway 60

# Point traffic to BLUE.
cp nginx/conf.d/upstreams/backend.blue.conf  nginx/conf.d/upstreams/backend.active.conf
cp nginx/conf.d/upstreams/frontend.blue.conf nginx/conf.d/upstreams/frontend.active.conf

# Validate and reload nginx config.
if ! docker compose exec -T gateway nginx -t; then
  docker compose logs --tail 120 gateway || true
  exit 1
fi

if ! docker compose exec -T gateway nginx -s reload; then
  docker compose logs --tail 120 gateway || true
  exit 1
fi

# Optional: stop green to save resources.
docker compose stop backend-green frontend-green 2>/dev/null || true

echo "Blue is up and traffic points to blue on frontend port ${FRONTEND_PORT}."
