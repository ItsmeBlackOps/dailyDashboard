# scripts/refresh.ps1 — one-command manual scraper refresh (PowerShell).
#
# Windows equivalent of scripts/refresh.sh. Loads .env first so per-source
# recency overrides (RECENCY_HOURS_*) and Supabase credentials are in scope
# for all subprocesses, then dispatches scripts/run_sources_sequentially.py.
#
# Usage:
#   .\scripts\refresh.ps1
#   .\scripts\refresh.ps1 --target 50
#   .\scripts\refresh.ps1 --sources greenhouse lever
#
# Flags are passed through to scripts/run_sources_sequentially.py.

$ErrorActionPreference = "Stop"

# Repo root = parent of scripts/
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$EnvPath = Join-Path $Root ".env"
if (Test-Path $EnvPath) {
    Get-Content $EnvPath | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $name = $matches[1]
            $value = $matches[2].Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
    Write-Host "[refresh] loaded .env"
} else {
    Write-Warning "[refresh] no .env found at $EnvPath — continuing without it"
}

# Prefer .venv python if present, else system python.
$VenvPy = Join-Path $Root ".venv\Scripts\python.exe"
if (Test-Path $VenvPy) {
    $Py = $VenvPy
} else {
    $Py = "python"
}

Write-Host "[refresh] using interpreter: $Py"
Write-Host "[refresh] starting sequential source run"
Write-Host ""

$env:PYTHONUNBUFFERED = "1"
& $Py "scripts\run_sources_sequentially.py" @args
$rc = $LASTEXITCODE

Write-Host ""
if ($rc -eq 0) {
    Write-Host "[refresh] done (exit 0)"
} else {
    Write-Error "[refresh] failed (exit $rc)"
}
exit $rc
