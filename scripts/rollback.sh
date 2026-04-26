#!/usr/bin/env bash
# Roll back the previous blue-green deploy in seconds.
# Just flips nginx upstream from the live color to the other.
# The other color's containers should still be running from the previous deploy.

set -euo pipefail

NGINX_DIR="nginx/conf.d/upstreams"

ACTIVE=$(grep -oE 'frontend-(blue|green)' "${NGINX_DIR}/frontend.active.conf" | head -1 | sed 's/frontend-//')
case "${ACTIVE}" in
  blue)  PREVIOUS=green ;;
  green) PREVIOUS=blue ;;
  *)     echo "ERROR: cannot detect active color" >&2; exit 1 ;;
esac

# Verify previous color's containers are alive
for c in "dailydb-frontend-${PREVIOUS}" "dailydb-backend-${PREVIOUS}"; do
  if ! docker ps --format '{{.Names}}' | grep -q "^${c}$"; then
    echo "ERROR: ${c} is not running. Cannot roll back automatically." >&2
    echo "       Start it manually: docker compose up -d ${c#dailydb-}" >&2
    exit 1
  fi
done

echo "Rolling back: ${ACTIVE} → ${PREVIOUS}"
cp "${NGINX_DIR}/frontend.${PREVIOUS}.conf" "${NGINX_DIR}/frontend.active.conf"
cp "${NGINX_DIR}/backend.${PREVIOUS}.conf"  "${NGINX_DIR}/backend.active.conf"

if docker ps --format '{{.Names}}' | grep -q dailydb-gateway; then
  docker exec dailydb-gateway nginx -s reload || docker restart dailydb-gateway
fi

echo "✅ Rolled back to ${PREVIOUS}. ${ACTIVE} containers are still running if you need to investigate."
