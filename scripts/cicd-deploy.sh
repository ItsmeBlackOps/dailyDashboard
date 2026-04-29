#!/usr/bin/env bash
# CI/CD blue-green deploy orchestrator.
# Triggered by GitHub Actions on push to main.
#
# Steps:
#   1. git pull
#   2. detect active color (blue or green)
#   3. build + start the INACTIVE color
#   4. wait for health
#   5. flip nginx upstream → reload gateway
#   6. tag previous image with git SHA for rollback
#   7. retain last 5 historical images, prune older
#
# Env: GIT_SHA, GIT_REF, ACTOR, TARGET_COLOR (auto|blue|green)

set -euo pipefail

GIT_SHA="${GIT_SHA:-unknown}"
GIT_REF="${GIT_REF:-unknown}"
ACTOR="${ACTOR:-cicd}"
TARGET_COLOR="${TARGET_COLOR:-auto}"
SHORT_SHA="${GIT_SHA:0:7}"
NGINX_DIR="nginx/conf.d/upstreams"
LOG_PREFIX="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"

log() { echo "${LOG_PREFIX} $*"; }

# ---------- 1. Pull latest (hard reset to discard any local VM mods) ----------
log "Fetching latest main"
git fetch --all --prune
git checkout main
git reset --hard origin/main
chmod +x scripts/*.sh 2>/dev/null || true
log "On commit $(git rev-parse --short HEAD) (${GIT_SHA})"

# ---------- 2. Detect active color ----------
if [ "${TARGET_COLOR}" = "auto" ]; then
  ACTIVE=$(grep -oE 'frontend-(blue|green)' "${NGINX_DIR}/frontend.active.conf" | head -1 | sed 's/frontend-//')
  case "${ACTIVE}" in
    blue)  TARGET=green ;;
    green) TARGET=blue ;;
    *)     TARGET=blue ;;
  esac
  log "Active color: ${ACTIVE:-none}; deploying to: ${TARGET}"
else
  TARGET="${TARGET_COLOR}"
  ACTIVE=$([ "${TARGET}" = "blue" ] && echo "green" || echo "blue")
  log "Forced target: ${TARGET}; previous active was: ${ACTIVE}"
fi

# ---------- 3. Build + start inactive color ----------
log "Cleaning any orphaned ${TARGET} containers"
# Remove any stopped/orphaned containers matching the target color names (handles weird hash-prefixed leftovers)
docker ps -a --format '{{.Names}}' | grep -E "(^|_)dailydb-(frontend|backend)-${TARGET}$" \
  | while read -r name; do
      log "  → removing orphan container ${name}"
      docker rm -f "${name}" >/dev/null 2>&1 || true
    done

log "Building dailydashboard-frontend-${TARGET} and dailydashboard-backend-${TARGET}"
docker compose build "frontend-${TARGET}" "backend-${TARGET}"
docker compose up -d --force-recreate --remove-orphans "frontend-${TARGET}" "backend-${TARGET}"

# ---------- 4. Wait for health ----------
wait_for_healthy() {
  local container="$1"
  local timeout="${2:-180}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    local status
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{if .State.Running}}running{{else}}stopped{{end}}{{end}}' "$container" 2>/dev/null || true)
    case "$status" in
      healthy|running)
        log "${container} is ${status}"
        return 0 ;;
      unhealthy|stopped|exited|dead)
        log "ERROR: ${container} entered ${status} state"
        docker logs --tail 80 "$container" || true
        return 1 ;;
    esac
    sleep 2
    elapsed=$((elapsed + 2))
  done
  log "ERROR: ${container} health-check timed out after ${timeout}s"
  docker logs --tail 80 "$container" || true
  return 1
}

wait_for_healthy "dailydb-frontend-${TARGET}"
wait_for_healthy "dailydb-backend-${TARGET}"

# ---------- 5. Flip nginx upstream ----------
log "Switching nginx upstream → ${TARGET}"
cp "${NGINX_DIR}/frontend.${TARGET}.conf" "${NGINX_DIR}/frontend.active.conf"
cp "${NGINX_DIR}/backend.${TARGET}.conf"  "${NGINX_DIR}/backend.active.conf"

# Reload gateway nginx without dropping connections.
# Tries: in-place reload → compose up → host nginx → noop (config already updated, will pick up later).
if docker ps --format '{{.Names}}' | grep -q '^dailydb-gateway$'; then
  log "Reloading dailydb-gateway nginx in-place"
  docker exec dailydb-gateway nginx -s reload \
    || { log "in-place reload failed; restarting gateway container"; docker restart dailydb-gateway; }
elif docker ps -a --format '{{.Names}}' | grep -q '^dailydb-gateway$'; then
  log "dailydb-gateway exists but is not running — starting it"
  docker start dailydb-gateway || docker compose up -d gateway || true
elif docker compose config --services 2>/dev/null | grep -q '^gateway$'; then
  log "Bringing up gateway via compose"
  docker compose up -d gateway || true
elif command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
  log "Reloading host nginx via systemctl"
  systemctl reload nginx || true
else
  log "WARNING: no gateway container or host nginx detected — config is updated but reload skipped"
fi

log "Traffic now served by ${TARGET}"

# ---------- 5b. Scraper (single instance, no blue/green) ----------
# Scraper talks only to the backend over the docker network — recreating
# it doesn't drop user traffic. Rebuild only when scraper source changed
# since the last deploy; otherwise just ensure the container is running.
SCRAPER_CONTAINER="dailydb-scraper"
PREV_SHA="$(grep -oE '"sha": *"[^"]*"' /var/lib/dailydashboard/last-deploy.json 2>/dev/null | head -1 | cut -d'"' -f4 || true)"

scraper_changed=false
if [ -n "${PREV_SHA}" ] && git rev-parse --verify "${PREV_SHA}" >/dev/null 2>&1; then
  if ! git diff --quiet "${PREV_SHA}" "${GIT_SHA}" -- scraper; then
    scraper_changed=true
  fi
else
  # No prior SHA recorded → first deploy or rollback; force rebuild.
  scraper_changed=true
fi

if [ "$scraper_changed" = "true" ]; then
  log "Rebuilding scraper (source changed since ${PREV_SHA:-no prior deploy})"
  docker compose build scraper
  docker compose up -d --force-recreate scraper
else
  log "Scraper source unchanged since ${PREV_SHA} — ensuring container is running"
  docker compose up -d scraper
fi
wait_for_healthy "${SCRAPER_CONTAINER}" 60 \
  || log "WARNING: scraper not healthy — backend job-search will fail until it recovers"

# ---------- 6. Tag images for rollback ----------
log "Tagging current images with SHA ${SHORT_SHA}"
docker tag "dailydashboard-frontend-${TARGET}:latest" "dailydashboard-frontend:${SHORT_SHA}" || true
docker tag "dailydashboard-backend-${TARGET}:latest"  "dailydashboard-backend:${SHORT_SHA}" || true

# Write a small marker for the rollback script
mkdir -p /var/lib/dailydashboard
cat > /var/lib/dailydashboard/last-deploy.json <<EOF
{
  "sha": "${GIT_SHA}",
  "shortSha": "${SHORT_SHA}",
  "ref": "${GIT_REF}",
  "actor": "${ACTOR}",
  "deployedColor": "${TARGET}",
  "previousColor": "${ACTIVE}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# ---------- 7. Retain last 5 SHA-tagged images ----------
log "Pruning old SHA-tagged images, keeping last 5"
for repo in dailydashboard-frontend dailydashboard-backend; do
  # list all tags newest→oldest, skip top 5, delete the rest
  docker images "${repo}" --format '{{.Tag}} {{.CreatedAt}}' \
    | grep -vE '^(latest|<none>) ' \
    | sort -k2 -r \
    | awk 'NR>5 {print $1}' \
    | while read -r old_tag; do
        log "  → removing ${repo}:${old_tag}"
        docker rmi "${repo}:${old_tag}" 2>/dev/null || true
      done
done

# Prune dangling images
docker image prune -f >/dev/null 2>&1 || true

log "✅ Deploy successful — ${TARGET} live at SHA ${SHORT_SHA}"
log "ℹ️  Previous color (${ACTIVE}) is still running for fast rollback. To roll back: bash scripts/rollback.sh"
