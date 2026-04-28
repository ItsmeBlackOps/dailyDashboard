# Resume-driven job scrape - friendly Windows wrapper around scrape_with_resume.py.
#
# Usage:
#   .\scripts\find-jobs.ps1 <resume_path> [-ExtraArgs '--linkedin-only --max-per-source 50']
#
# Required env (shell or .env):
#   APIFY_TOKEN, plus one of OPENAI_API_KEY / ANTHROPIC_API_KEY

param(
  [Parameter(Mandatory=$true, Position=0)]
  [string]$Resume,
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$ExtraArgs
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path $Resume)) {
  Write-Error "resume not found: $Resume"
  exit 2
}

# Load .env if present
if (Test-Path .env) {
  Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
    }
  }
}

$missing = @()
if (-not $env:APIFY_TOKEN) { $missing += 'APIFY_TOKEN' }
if (-not $env:OPENAI_API_KEY -and -not $env:ANTHROPIC_API_KEY) {
  $missing += 'OPENAI_API_KEY or ANTHROPIC_API_KEY'
}
if ($missing.Count -gt 0) {
  Write-Error "Missing env: $($missing -join ', '). Set in .env or shell."
  exit 2
}

$pyArgs = @('-X', 'utf8', 'scripts/scrape_with_resume.py', $Resume, '--no-ingest', '--max-per-source', '25')
if ($ExtraArgs) { $pyArgs += $ExtraArgs }
& python @pyArgs
