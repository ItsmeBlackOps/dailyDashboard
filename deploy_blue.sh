# Save as: up_blue.sh
# Run from the folder that has docker-compose.yml

#!/usr/bin/env bash
set -euo pipefail

echo "Starting blue deploy"

# Stop containers that already bind the host ports (3004, 8180), except the gateway.
for p in 3004 8180; do
  clash="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "0\.0\.0\.0:${p}->" || true)"
  if [ -n "$clash" ] && ! echo "$clash" | grep -q "dailydb-gateway"; then
    echo "Port ${p} is busy. Stop the container that binds it before you run this script:"
    echo "$clash"
    exit 1
  fi
done

docker compose up -d backend-blue frontend-blue gateway

echo "Reloading nginx"

# Switch traffic to BLUE
if [ -f nginx/conf.d/upstreams/backend.blue.conf ] && [ -f nginx/conf.d/upstreams/frontend.blue.conf ]; then
  cp nginx/conf.d/upstreams/backend.blue.conf  nginx/conf.d/upstreams/backend.active.conf
  cp nginx/conf.d/upstreams/frontend.blue.conf nginx/conf.d/upstreams/frontend.active.conf
else
  # Fallback: edit gateway.conf if you do not use upstream include files
  CONF="nginx/conf.d/gateway.conf"
  sed -i 's/^[[:space:]]*#\?[[:space:]]*server[[:space:]]\+backend-blue:3004;[[:space:]]*$/    server backend-blue:3004;/' "$CONF" || true
  sed -i 's/^[[:space:]]*server[[:space:]]\+backend-green:3004;[[:space:]]*$/    # server backend-green:3004;/' "$CONF" || true

  sed -i 's/^[[:space:]]*#\?[[:space:]]*server[[:space:]]\+frontend-blue:8180;[[:space:]]*$/    server frontend-blue:8180;/' "$CONF" || true
  sed -i 's/^[[:space:]]*server[[:space:]]\+frontend-green:8180;[[:space:]]*$/    # server frontend-green:8180;/' "$CONF" || true
fi

docker compose exec -T gateway nginx -s reload

# Optional: stop green to save RAM/CPU
docker compose stop backend-green frontend-green 2>/dev/null || true

echo "Blue is up and traffic points to blue."
