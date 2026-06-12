#!/usr/bin/env bash
# Packages the extension into a shareable zip for manual (load-unpacked)
# distribution. Reads the version from manifest.json and writes
# dist/interview-meeting-detector-v<version>.zip containing the extension files
# at the zip root (so unzipping yields a folder with manifest.json inside).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

version="$(node -p "require('./manifest.json').version" 2>/dev/null || echo "0.0.0")"
out="dist/interview-meeting-detector-v${version}.zip"
mkdir -p dist
rm -f "$out"

# Only the files the browser needs to run the extension.
files=(manifest.json background.js content.js dashboard-bridge.js options.html options.js popup.html popup.js README.md)

if command -v zip >/dev/null 2>&1; then
  zip -q "$out" "${files[@]}"
elif command -v powershell >/dev/null 2>&1; then
  # Windows fallback — Compress-Archive (paths relative to this dir).
  list="$(printf '"%s",' "${files[@]}")"; list="${list%,}"
  powershell -NoProfile -Command "Compress-Archive -Path ${list} -DestinationPath '${out}' -Force"
else
  echo "Need 'zip' or 'powershell' to package." >&2
  exit 1
fi

echo "Wrote $here/$out"
