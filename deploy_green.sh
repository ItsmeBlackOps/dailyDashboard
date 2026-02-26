#!/usr/bin/env bash
set -euo pipefail

echo "Starting green deploy"

BACKEND_PORT="${PORT:-3004}"
FRONTEND_PORT="${FRONTEND_PORT:-8180}"

# Only frontend should be host-published through gateway.
clash="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "0\.0\.0\.0:${FRONTEND_PORT}->" || true)"
if [ -n "$clash" ] && ! echo "$clash" | grep -q "dailydb-gateway"; then
  echo "Port ${FRONTEND_PORT} is busy. Stop the container that binds it before running this script:"
  echo "$clash"
  exit 1
fi

# Bring up target stack first so nginx can resolve upstream names.
docker compose up -d backend-green frontend-green

# Ensure gateway exists/runs.
docker compose up -d gateway

# Point traffic to GREEN.
cp nginx/conf.d/upstreams/backend.green.conf  nginx/conf.d/upstreams/backend.active.conf
cp nginx/conf.d/upstreams/frontend.green.conf nginx/conf.d/upstreams/frontend.active.conf

# Validate and reload nginx config.
docker compose exec -T gateway nginx -t
docker compose exec -T gateway nginx -s reload

echo "Green is up and traffic points to green on frontend port ${FRONTEND_PORT}."
