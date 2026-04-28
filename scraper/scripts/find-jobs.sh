#!/usr/bin/env bash
# Resume-driven job scrape — friendly wrapper around scrape_with_resume.py.
#
# Usage:
#   scripts/find-jobs.sh <resume_path> [extra args...]
#
# Required env (in shell or .env):
#   APIFY_TOKEN, plus one of OPENAI_API_KEY / ANTHROPIC_API_KEY
#
# Examples:
#   scripts/find-jobs.sh resume.txt
#   scripts/find-jobs.sh resume.pdf --max-per-source 50 --linkedin-only
#   RESUME_SCRAPE_LOCATION="Remote" scripts/find-jobs.sh resume.md

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <resume_path> [extra args...]" >&2
  exit 2
fi

RESUME="$1"; shift
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$RESUME" ]]; then
  echo "resume not found: $RESUME" >&2
  exit 2
fi

# Load .env if present (export every line that's a KEY=value).
if [[ -f .env ]]; then
  set -a; . ./.env; set +a
fi

missing=()
[[ -z "${APIFY_TOKEN:-}" ]] && missing+=("APIFY_TOKEN")
if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
  missing+=("OPENAI_API_KEY or ANTHROPIC_API_KEY")
fi
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing env: ${missing[*]}" >&2
  echo "Set in .env or export in shell, then retry." >&2
  exit 2
fi

python -X utf8 scripts/scrape_with_resume.py "$RESUME" --no-ingest --max-per-source 25 "$@"
