# Miku AI Studio - API key wiper
#
# Purpose: remove the LLM API configuration (apiKey / baseUrl / enabled) from disk,
# so that the next boot starts with no remembered key.
#
# Scope: ONLY touches <root>\data\settings.json (or $env:DATA_DIR\settings.json).
#        Projects, novels, hot-board cache and the SQLite index are never touched.
# Safety: the key itself is never printed and never written to any log.
#         Log entries only record had=1/0 and the action taken.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File wipe-api-key.ps1
#   powershell ... -File wipe-api-key.ps1 -Purge     (delete the file instead of emptying it)
#   powershell ... -File wipe-api-key.ps1 -Quiet     (no stdout, for scheduled tasks)

param(
  [switch]$Quiet,
  [switch]$Purge
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dataDirName = if ($env:DATA_DIR) { $env:DATA_DIR } else { 'data' }
$dataDir = Join-Path $root $dataDirName
$file = Join-Path $dataDir 'settings.json'
$logFile = Join-Path $dataDir 'wipe.log'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-WipeLog([string]$line) {
  try {
    if (-not (Test-Path -LiteralPath $dataDir)) {
      New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    }
    Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
  } catch {
    # logging must never break the wipe itself
  }
}

$had = '0'
$action = 'absent'
$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')

try {
  if (Test-Path -LiteralPath $file) {
    $readable = $true
    $apiKeyLen = 0
    try {
      $raw = Get-Content -LiteralPath $file -Raw -Encoding utf8
      if ($raw -and $raw.Trim().Length -gt 0) {
        $obj = $raw | ConvertFrom-Json
        if ($obj -and $obj.llm) {
          if ($obj.llm.apiKey) { $apiKeyLen = ([string]$obj.llm.apiKey).Length }
          if ($obj.llm.apiKey -or $obj.llm.baseUrl -or $obj.llm.enabled) { $had = '1' }
        }
      }
    } catch {
      # Unreadable / malformed file: treat as sensitive and overwrite it.
      $readable = $false
      $had = '1'
    }

    if ($Purge) {
      Remove-Item -LiteralPath $file -Force
      $action = 'deleted'
    } else {
      # Fixed payload on purpose: settings.json only ever holds the top-level "llm" key,
      # and a hand-built string avoids ConvertTo-Json quirks on empty objects.
      [IO.File]::WriteAllText($file, "{`"llm`": {}}`r`n", $utf8NoBom)
      $action = 'cleared'
    }

    if (-not $readable) { $action = "$action-unreadable" }
    if ($apiKeyLen -gt 0) { $action = "$action-keylen$apiKeyLen" }
  } else {
    $action = 'absent'
  }

  Write-WipeLog "[$stamp] wipe had=$had action=$action file=$file"
  if (-not $Quiet) {
    Write-Output "wipe had=$had action=$action"
  }
  exit 0
} catch {
  Write-WipeLog "[$stamp] wipe FAILED $($_.Exception.Message)"
  if (-not $Quiet) { Write-Output "wipe FAILED: $($_.Exception.Message)" }
  exit 1
}
