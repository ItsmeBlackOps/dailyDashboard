# Save as: merge_green_to_blue.sh
# This script makes BLUE use the same images as GREEN, then it points traffic back to BLUE.
# Run from the folder that has docker-compose.yml

#!/usr/bin/env bash
set -euo pipefail

docker compose up -d backend-green frontend-green gateway

# Switch traffic to GREEN first
if [ -f nginx/conf.d/upstreams/backend.green.conf ] && [ -f nginx/conf.d/upstreams/frontend.green.conf ]; then
  cp nginx/conf.d/upstreams/backend.green.conf  nginx/conf.d/upstreams/backend.active.conf
  cp nginx/conf.d/upstreams/frontend.green.conf nginx/conf.d/upstreams/frontend.active.conf
else
  CONF="nginx/conf.d/gateway.conf"
  sed -i 's/^[[:space:]]*#\?[[:space:]]*server[[:space:]]\+backend-green:3004;[[:space:]]*$/    server backend-green:3004;/' "$CONF" || true
  sed -i 's/^[[:space:]]*server[[:space:]]\+backend-blue:3004;[[:space:]]*$/    # server backend-blue:3004;/' "$CONF" || true

  sed -i 's/^[[:space:]]*#\?[[:space:]]*server[[:space:]]\+frontend-green:8180;[[:space:]]*$/    server frontend-green:8180;/' "$CONF" || true
  sed -i 's/^[[:space:]]*server[[:space:]]\+frontend-blue:8180;[[:space:]]*$/    # server frontend-blue:8180;/' "$CONF" || true
fi

docker compose exec -T gateway nginx -s reload

# Read image names that BLUE uses today
BLUE_BACKEND_IMAGE="$(docker inspect --format '{{.Config.Image}}' dailydb-backend-blue 2>/dev/null || echo 'dailydashboard-backend-blue:latest')"
BLUE_FRONTEND_IMAGE="$(docker inspect --format '{{.Config.Image}}' dailydb-frontend-blue 2>/dev/null || echo 'dailydashboard-frontend-blue:latest')"

# Tag GREEN images into BLUE image names
GREEN_BACKEND_ID="$(docker inspect --format '{{.Image}}' dailydb-backend-green)"
GREEN_FRONTEND_ID="$(docker inspect --format '{{.Image}}' dailydb-frontend-green)"

docker tag "$GREEN_BACKEND_ID"  "$BLUE_BACKEND_IMAGE"
docker tag "$GREEN_FRONTEND_ID" "$BLUE_FRONTEND_IMAGE"

# Recreate BLUE containers using the new tags, without building
docker compose up -d --no-build --force-recreate backend-blue frontend-blue

# Switch traffic back to BLUE
if [ -f nginx/conf.d/upstreams/backend.blue.conf ] && [ -f nginx/conf.d/upstreams/frontend.blue.conf ]; then
  cp nginx/conf.d/upstreams/backend.blue.conf  nginx/conf.d/upstreams/backend.active.conf
  cp nginx/conf.d/upstreams/frontend.blue.conf nginx/conf.d/upstreams/frontend.active.conf
else
  CONF="nginx/conf.d/gateway.conf"
  sed -i 's/^[[:space:]]*#\?[[:space:]]*server[[:space:]]\+backend-blue:3004;[[:space:]]*$/    server backend-blue:3004;/' "$CONF" || true
  sed -i 's/^[[:space:]]*server[[:space:]]\+backend-green:3004;[[:space:]]*$/    # server backend-green:3004;/' "$CONF" || true

  sed -i 's/^[[:space:]]*#\?[[:space:]]*server[[:space:]]\+frontend-blue:8180;[[:space:]]*$/    server frontend-blue:8180;/' "$CONF" || true
  sed -i 's/^[[:space:]]*server[[:space:]]\+frontend-green:8180;[[:space:]]*$/    # server frontend-green:8180;/' "$CONF" || true
fi

docker compose exec -T gateway nginx -s reload

# Stop GREEN
docker compose stop backend-green frontend-green 2>/dev/null || true

echo "Green merged into blue. Blue runs the green images. Traffic points to blue."
