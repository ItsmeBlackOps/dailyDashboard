# scripts/diagnose.ps1 — one-command per-source diagnostic (PowerShell).
#
# Windows equivalent of scripts/diagnose.sh. Runs run_daily.py --diagnose
# <source> and points the operator at the newest report file.
#
# Usage:
#   .\scripts\diagnose.ps1 greenhouse
#   .\scripts\diagnose.ps1 greenhouse --target 50
#   .\scripts\diagnose.ps1 greenhouse --no-ingest

$ErrorActionPreference = "Stop"

if ($args.Count -lt 1 -or $args[0].StartsWith("--")) {
    Write-Error "usage: .\scripts\diagnose.ps1 <source> [--target N] [--no-ingest]"
    exit 1
}

$Source = $args[0]
$Rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

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
}

# Prefer .venv python if present, else system python.
$VenvPy = Join-Path $Root ".venv\Scripts\python.exe"
if (Test-Path $VenvPy) {
    $Py = $VenvPy
} else {
    $Py = "python"
}

Write-Host "[diagnose] source=$Source interpreter=$Py"
$env:PYTHONUNBUFFERED = "1"
& $Py "run_daily.py" "--diagnose" $Source @Rest
$rc = $LASTEXITCODE

Write-Host ""
if ($rc -eq 0) {
    $latest = Get-ChildItem -Path "data\reports\diagnose_${Source}_*.json" -ErrorAction SilentlyContinue |
              Sort-Object -Property LastWriteTime -Descending | Select-Object -First 1
    if ($latest) {
        Write-Host "[diagnose] report -> $($latest.FullName)"
    }
}
exit $rc
