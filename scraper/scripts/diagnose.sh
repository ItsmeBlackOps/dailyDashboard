#!/usr/bin/env bash
# scripts/diagnose.sh — one-command per-source diagnostic.
#
# Runs src/diagnose.py for a single source and writes a per-stage JSON
# report to data/reports/diagnose_<source>_<ISO-ts>.json. The stages
# (fetch_seeds → fetch_listings → parse_listings → normalize →
# recency_filter → dedup_check → ingest) reveal exactly where rows die.
#
# Usage:
#   scripts/diagnose.sh greenhouse               # full run, writes rows
#   scripts/diagnose.sh greenhouse --target 50   # tighter sample
#   scripts/diagnose.sh greenhouse --no-ingest   # dry run, no writes
#
# First positional arg must be the source name. All other flags pass
# through to `python run_daily.py --diagnose <source>`.
#
# Exit codes:
#   0 = diagnostic ran to completion (report written)
#   1 = missing source arg
#   other = run_daily.py exit code
set -euo pipefail

if [[ $# -lt 1 || "$1" == --* ]]; then
  echo "usage: scripts/diagnose.sh <source> [--target N] [--no-ingest]" >&2
  echo "       source is a registered scraper name (e.g. greenhouse, lever, workday)" >&2
  exit 1
fi

SOURCE="$1"
shift

# Repo root = parent of scripts/
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

# Prefer .venv python if present, else system python.
if [[ -x ".venv/bin/python" ]]; then
  PY=".venv/bin/python"
elif [[ -x ".venv/Scripts/python.exe" ]]; then
  PY=".venv/Scripts/python.exe"
else
  PY="python"
fi

echo "[diagnose] source=$SOURCE interpreter=$PY"
export PYTHONUNBUFFERED=1
"$PY" run_daily.py --diagnose "$SOURCE" "$@"
rc=$?

echo ""
if [[ $rc -eq 0 ]]; then
  # Point the operator at the newest report for this source.
  latest="$(ls -t data/reports/diagnose_${SOURCE}_*.json 2>/dev/null | head -n 1 || true)"
  if [[ -n "$latest" ]]; then
    echo "[diagnose] report -> $latest"
  fi
fi
exit $rc
