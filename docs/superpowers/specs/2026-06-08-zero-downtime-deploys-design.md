# Zero-Downtime Deploys — Design

> Date: 2026-06-08. Scope: deploy infra (docker-compose healthchecks). Branch: `feat/zero-downtime-deploys`.

## Problem

Every blue/green deploy causes a ~1–2 min window of **502s**: nginx flips traffic to the new color before the new backend is actually serving HTTP.

## Root cause (verified)

`scripts/cicd-deploy.sh` **already** gates the nginx flip on health — it calls `wait_for_healthy` for the new frontend + backend containers (lines 117–118) *before* copying the active upstream conf + reloading the gateway (lines 122–130). The gap is in *what* "healthy" means:

`wait_for_healthy` (lines 93–115) inspects `{{if .State.Health}}{{.State.Health.Status}}{{else}}{{if .State.Running}}running{{else}}stopped{{end}}{{end}}` and treats **`running`** as success. But the `backend-blue`, `backend-green`, `frontend-blue`, `frontend-green` services have **no `healthcheck:` defined** in `docker-compose.yml` (only `scraper` does, line 90). So `.State.Health` is empty → the function accepts `running` the instant the container *process* starts — before Express is listening / Atlas is connected → nginx flips → 502s until the app finishes booting.

The readiness endpoint already exists: `setupHealthCheck` in `backend/src/middleware/index.js` mounts a public `GET /health` (plus `/ready`, `/live`), and `/api/health` exists too.

## Fix (minimal — `docker-compose.yml` only)

Add a Docker `healthcheck:` to the four blue/green services so the **existing** `wait_for_healthy` gate waits for real readiness. Both images are `node:20-alpine` (no `curl`), so use Node's built-in `fetch` (no new dependency):

**backend-blue / backend-green:**
```yaml
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:'+(process.env.PORT||3004)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 40s
```

**frontend-blue / frontend-green:**
```yaml
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:'+(process.env.FRONTEND_PORT||8180)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
```

(`process.env.PORT` / `FRONTEND_PORT` are read inside Node at container runtime — no Compose `$$` escaping needed. Ports default to the Dockerfile `EXPOSE` values 3004 / 8180.)

No logic change to `cicd-deploy.sh` (it already gates correctly once health is real) — only a one-line clarifying comment near `wait_for_healthy`.

## Why it works

With a healthcheck defined, the container reports `starting` → `healthy`. `wait_for_healthy` (180s default timeout) keeps polling through `starting` (its `case` has no match for `starting`, so it loops) and returns only on `healthy` — i.e. once the app actually serves `GET /health`. So the nginx flip happens with the new backend ready → **zero downtime**.

## Fail-safe bonus

If a new build never becomes healthy (crash, bad migration, Atlas unreachable), `wait_for_healthy` returns non-zero → the deploy **aborts before the flip** → the old color keeps serving. Today a broken build can flip and 502 the whole site; after this, it can't.

## Risk + mitigation

A *wrong* healthcheck command would mark the container `unhealthy` → abort **every** deploy. This is fail-safe (old color keeps serving — not user-facing) but blocks shipping until fixed. Mitigations:
- `node` + global `fetch` are guaranteed on `node:20-alpine` (fetch is global since Node 18); `/health` is public (no auth).
- Generous `start_period` so slow boots don't get marked unhealthy.
- **Verify on the first deploy:** the deploy log should show the new backend/frontend reaching `is healthy` (not `is running`), and a probe during the deploy should show **no 502 window**. If it ever misfires, the fix is to revert/adjust the one healthcheck block.

## Files

- `docker-compose.yml` — four `healthcheck:` blocks (backend/frontend × blue/green).
- `scripts/cicd-deploy.sh` — one clarifying comment near `wait_for_healthy` (no logic change).

## Testing / rollout

- `docker compose config` validates the healthcheck syntax pre-merge.
- Real validation is the next deploy: confirm the log shows `dailydb-backend-<color> is healthy` before the upstream switch, and that hitting the site during the deploy no longer returns 502. The fail-safe (abort-before-flip on unhealthy) means a mistake degrades to "deploy didn't ship," never "site is down."

## Out of scope

Frontend bundle perf (Batch 2), Create Meeting fast-follow, the EAD-start-date form change, secret rotations — all tracked separately.
