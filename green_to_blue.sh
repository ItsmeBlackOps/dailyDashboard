#!/usr/bin/env bash
set -euo pipefail

# This script makes BLUE use GREEN images, then switches traffic back to BLUE.

echo "Merging green images into blue"

# Ensure green stack and gateway are running.
docker compose up -d backend-green frontend-green gateway

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

# Switch traffic back to BLUE.
cp nginx/conf.d/upstreams/backend.blue.conf  nginx/conf.d/upstreams/backend.active.conf
cp nginx/conf.d/upstreams/frontend.blue.conf nginx/conf.d/upstreams/frontend.active.conf
docker compose exec -T gateway nginx -t
docker compose exec -T gateway nginx -s reload

# Optional: stop GREEN stack after merge.
docker compose stop backend-green frontend-green 2>/dev/null || true

echo "Green merged into blue. Traffic points to blue."
