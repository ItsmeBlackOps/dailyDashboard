#!/usr/bin/env bash
set -euo pipefail

# This script makes BLUE use GREEN images, then switches traffic back to BLUE.

echo "Merging green images into blue"

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

# Ensure green stack and gateway are running.
docker compose up -d backend-green frontend-green gateway
wait_for_healthy dailydb-backend-green
wait_for_healthy dailydb-frontend-green
wait_for_healthy dailydb-gateway 60

# Switch traffic to GREEN first.
cp nginx/conf.d/upstreams/backend.green.conf  nginx/conf.d/upstreams/backend.active.conf
cp nginx/conf.d/upstreams/frontend.green.conf nginx/conf.d/upstreams/frontend.active.conf
docker compose exec -T gateway nginx -t
docker compose exec -T gateway nginx -s reload

# Resolve current BLUE image tags.
BLUE_BACKEND_IMAGE="$(docker inspect --format '{{.Config.Image}}' dailydb-backend-blue 2>/dev/null || echo 'dailydashboard-backend-blue:latest')"
BLUE_FRONTEND_IMAGE="$(docker inspect --format '{{.Config.Image}}' dailydb-frontend-blue 2>/dev/null || echo 'dailydashboard-frontend-blue:latest')"

# Read GREEN image IDs.
GREEN_BACKEND_ID="$(docker inspect --format '{{.Image}}' dailydb-backend-green)"
GREEN_FRONTEND_ID="$(docker inspect --format '{{.Image}}' dailydb-frontend-green)"

# Tag GREEN images into BLUE image tags.
docker tag "$GREEN_BACKEND_ID" "$BLUE_BACKEND_IMAGE"
docker tag "$GREEN_FRONTEND_ID" "$BLUE_FRONTEND_IMAGE"

# Recreate BLUE containers from updated tags.
docker compose up -d --no-build --force-recreate backend-blue frontend-blue
wait_for_healthy dailydb-backend-blue
wait_for_healthy dailydb-frontend-blue

# Switch traffic back to BLUE.
cp nginx/conf.d/upstreams/backend.blue.conf  nginx/conf.d/upstreams/backend.active.conf
cp nginx/conf.d/upstreams/frontend.blue.conf nginx/conf.d/upstreams/frontend.active.conf
docker compose exec -T gateway nginx -t
docker compose exec -T gateway nginx -s reload

# Optional: stop GREEN stack after merge.
docker compose stop backend-green frontend-green 2>/dev/null || true

echo "Green merged into blue. Traffic points to blue."
