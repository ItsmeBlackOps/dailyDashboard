#!/usr/bin/env bash
# scripts/refresh.sh — one-command manual scraper refresh.
#
# Runs every registered source sequentially via the existing
# run_sources_sequentially.py wrapper. Loads .env first so per-source
# recency overrides (RECENCY_HOURS_*) and Supabase credentials are
# in scope for all subprocesses.
#
# Usage:
#   scripts/refresh.sh                    # target 100 per source (default)
#   scripts/refresh.sh --target 50        # tighter per-source cap
#   scripts/refresh.sh --sources greenhouse lever   # restrict
#
# Flags are passed through to scripts/run_sources_sequentially.py.
#
# Exit codes:
#   0 = sequential runner exited cleanly
#   non-zero = sequential runner failed (exit code preserved)
set -euo pipefail

# Repo root = parent of scripts/
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
  echo "[refresh] loaded .env"
else
  echo "[refresh] warning: no .env found at $ROOT/.env — continuing without it" >&2
fi

# Prefer .venv python if present, else system python.
if [[ -x ".venv/bin/python" ]]; then
  PY=".venv/bin/python"
elif [[ -x ".venv/Scripts/python.exe" ]]; then
  PY=".venv/Scripts/python.exe"
else
  PY="python"
fi

echo "[refresh] using interpreter: $PY"
echo "[refresh] starting sequential source run"
echo ""

export PYTHONUNBUFFERED=1
"$PY" scripts/run_sources_sequentially.py "$@"
rc=$?

echo ""
if [[ $rc -eq 0 ]]; then
  echo "[refresh] done (exit 0)"
else
  echo "[refresh] failed (exit $rc)" >&2
fi
exit $rc
