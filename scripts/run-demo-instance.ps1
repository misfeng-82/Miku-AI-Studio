# Start the public DEMO instance of Miku AI Studio.
#
# Why a second instance:
#   The main instance (8787) holds the owner's LLM API key and 128 real projects.
#   This demo instance runs on 8790 with its own empty data dir, no API key,
#   and USE_MOCK=1 (offline samples). Visitors can use the offline tools
#   (quality gates, storyboard, line book, hot board, exports) without ever
#   touching the owner's key or projects.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-demo-instance.ps1
#   powershell ... -File scripts\run-demo-instance.ps1 -Stop

param(
  [switch]$Stop,
  [string]$Root = ''
)

$ErrorActionPreference = 'Stop'
# $PSScriptRoot = <project>\01_xxxx\scripts ; keep Chinese out of literals (PS 5.1 reads UTF-8 no-BOM as ANSI)
$proj = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = Split-Path -Parent $proj }

$dataDir = Join-Path $Root 'demo-data'
$tokenFile = Join-Path $Root 'tools\demo-token.txt'

$pidFile = Join-Path $Root 'tools\demo.pid'

if ($Stop) {
  if (Test-Path -LiteralPath $pidFile) {
    $oldPid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($oldPid -match '^\d+$') {
      try {
        Stop-Process -Id ([int]$oldPid) -Force -ErrorAction Stop
        Write-Output "stopped demo instance pid=$oldPid"
      } catch {
        Write-Output "pid $oldPid not running"
      }
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  } else {
    Write-Output 'demo instance: no pid file (already stopped?)'
  }
  exit 0
}

if (-not (Test-Path -LiteralPath $tokenFile)) {
  Write-Output "ERROR: token file missing: $tokenFile"
  exit 1
}
$token = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
if (-not $token) { Write-Output 'ERROR: token is empty'; exit 1 }

if (-not (Test-Path -LiteralPath $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }

$env:PORT = '8790'
$env:HOST = '127.0.0.1'
$env:DATA_DIR = $dataDir
$env:USE_MOCK = '1'
$env:CANVAS_PORT = '5190'
$env:ACCESS_TOKEN = $token
$env:WIPE_KEY_ON_START = '0'

$outLog = Join-Path $dataDir 'server.out.log'
$errLog = Join-Path $dataDir 'server.err.log'

$proc = Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -WorkingDirectory $proj -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
if ($proc) {
  Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding utf8
  Write-Output "demo instance pid=$($proc.Id)"
}
Start-Sleep -Seconds 6

try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8790/health' -TimeoutSec 10 -UseBasicParsing
  Write-Output "demo instance: health=$($r.StatusCode) url=http://127.0.0.1:8790"
} catch {
  Write-Output "demo instance: health check failed - $($_.Exception.Message)"
  Write-Output "log: $outLog"
}
