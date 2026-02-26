#!/usr/bin/env bash
set -euo pipefail

echo "Starting blue deploy"

FRONTEND_PORT="${FRONTEND_PORT:-8180}"

# Only frontend should be host-published through gateway.
clash="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "0\.0\.0\.0:${FRONTEND_PORT}->" || true)"
if [ -n "$clash" ] && ! echo "$clash" | grep -q "dailydb-gateway"; then
  echo "Port ${FRONTEND_PORT} is busy. Stop the container that binds it before running this script:"
  echo "$clash"
  exit 1
fi

# Bring up target stack first so nginx can resolve upstream names.
docker compose up -d backend-blue frontend-blue

# Ensure gateway exists/runs.
docker compose up -d gateway

# Point traffic to BLUE.
cp nginx/conf.d/upstreams/backend.blue.conf  nginx/conf.d/upstreams/backend.active.conf
cp nginx/conf.d/upstreams/frontend.blue.conf nginx/conf.d/upstreams/frontend.active.conf

# Validate and reload nginx config.
docker compose exec -T gateway nginx -t
docker compose exec -T gateway nginx -s reload

# Optional: stop green to save resources.
docker compose stop backend-green frontend-green 2>/dev/null || true

echo "Blue is up and traffic points to blue on frontend port ${FRONTEND_PORT}."
