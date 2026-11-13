# Register the API-key wiper so it runs when the machine shuts down,
# and once more at boot as a fallback (shutdown hooks can be killed by Windows).
#
# Run this script in PowerShell. Administrator is preferred (SYSTEM-level task).
# Without administrator it falls back to a current-user task (still works while logged on).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-wipe-on-shutdown.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-wipe-on-shutdown.ps1 -Uninstall
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-wipe-on-shutdown.ps1 -Status

param(
  [switch]$Uninstall,
  [switch]$Status,
  [string]$TaskName = 'Miku-Wipe-API-On-Shutdown'
)

$ErrorActionPreference = 'Stop'
$wiper = Join-Path $PSScriptRoot 'wipe-api-key.ps1'

if (-not (Test-Path -LiteralPath $wiper)) {
  Write-Output "ERROR: wiper script not found: $wiper"
  exit 1
}

if ($Uninstall) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "removed task: $TaskName"
  } else {
    Write-Output "task not found: $TaskName"
  }
  exit 0
}

if ($Status) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { Write-Output "not installed: $TaskName"; exit 0 }
  Write-Output "task: $($t.TaskName) state=$($t.State)"
  $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($info) {
    Write-Output "lastRun=$($info.LastRunTime) lastResult=$($info.LastTaskResult) nextRun=$($info.NextRunTime)"
  }
  foreach ($tr in $t.Triggers) { Write-Output "trigger: $($tr.CimClass.CimClassName)" }
  $a = $t.Actions[0]
  Write-Output "action: $($a.Execute) $($a.Arguments)"
  exit 0
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$meSid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value

# Shutdown-relevant triggers:
#   1074 = a process/user initiated shutdown or restart (User32)
#   6006 = event log service stopped (very last stage of shutdown, EventLog)
$sub1074 = "&lt;QueryList&gt;&lt;Query Id=&quot;0&quot; Path=&quot;System&quot;&gt;&lt;Select Path=&quot;System&quot;&gt;*[System[Provider[@Name='User32'] and EventID=1074]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;"
$sub6006 = "&lt;QueryList&gt;&lt;Query Id=&quot;0&quot; Path=&quot;System&quot;&gt;&lt;Select Path=&quot;System&quot;&gt;*[System[Provider[@Name='EventLog'] and EventID=6006]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;"

$eventTriggers = @"
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>$sub1074</Subscription>
    </EventTrigger>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>$sub6006</Subscription>
    </EventTrigger>
"@

$bootTrigger = @"
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT20S</Delay>
    </BootTrigger>
"@

$logonTrigger = @"
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT5S</Delay>
    </LogonTrigger>
"@

$argsStr = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wiper`" -Quiet"

if ($isAdmin) {
  $principal = '<Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>'
  $triggers = $eventTriggers + $bootTrigger
} else {
  $principal = "<Principals><Principal id=`"Author`"><UserId>$meSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>"
  $triggers = $eventTriggers + $logonTrigger
}

# Settings children must follow the Task Scheduler schema order exactly:
# Enabled -> Hidden -> ExecutionTimeLimit -> MultipleInstancesPolicy ->
# DisallowStartIfOnBatteries -> StopIfGoingOnBatteries -> AllowHardTerminate -> StartWhenAvailable
$settings = @'
  <Settings>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT1M</ExecutionTimeLimit>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
  </Settings>
'@

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Miku AI Studio: wipe saved LLM API key on shutdown and at boot (data/settings.json only)</Description>
  </RegistrationInfo>
  <Triggers>
$triggers  </Triggers>
  $principal
$settings
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>$argsStr</Arguments>
    </Exec>
  </Actions>
</Task>
"@

try {
  Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
  Write-Output "installed task: $TaskName (mode=$(if ($isAdmin) { 'SYSTEM' } else { 'current-user' }))"
  Write-Output "wiper: $wiper"
  $t = Get-ScheduledTask -TaskName $TaskName
  foreach ($tr in $t.Triggers) { Write-Output "trigger: $($tr.CimClass.CimClassName)" }
  exit 0
} catch {
  Write-Output "ERROR: failed to register task: $($_.Exception.Message)"
  Write-Output "Hint: run PowerShell as Administrator, or use the -Uninstall/-Status switches to inspect."
  exit 1
}
