$ErrorActionPreference = 'Continue'
$app = Join-Path $env:LOCALAPPDATA 'RenewalLedger'
$taskName = 'PROCURE360 Backup'
Write-Host ''
Write-Host 'PROCURE360 - scheduled backup'
Write-Host ''
if (-not (Test-Path (Join-Path $app 'data'))) { Write-Host 'PROCURE360 is not installed yet (no data folder). Run Install.bat first.'; exit 1 }

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Write-Host "A scheduled backup already exists ($taskName)."
  $a = Read-Host 'Type R to remove it, C to change it, or press Enter to leave it as is'
  if ($a -match '^[Rr]') { schtasks /Delete /TN $taskName /F | Out-Null; Write-Host 'The scheduled backup was removed.'; exit 0 }
  if ($a -notmatch '^[Cc]') { exit 0 }
}

$folder = (Read-Host 'Folder for the backups (local or network, e.g. \\server\share\procure360)').Trim().Trim('"')
if (-not $folder) { Write-Host 'No folder given.'; exit 1 }
if (-not (Test-Path -LiteralPath $folder -PathType Container)) { Write-Host "The folder was not found: $folder"; Write-Host 'Check the path and that you can reach it from this computer.'; exit 1 }
try { $probe = Join-Path $folder ('.p360-test-' + [guid]::NewGuid().ToString('N')); Set-Content -LiteralPath $probe -Value 'x'; Remove-Item -LiteralPath $probe -Force }
catch { Write-Host 'You do not have permission to write to that folder.'; exit 1 }

$f = (Read-Host 'How often? W = every week, M = every month [W]').Trim()
$monthly = $f -match '^[Mm]'
$time = (Read-Host 'At what time (24h HH:MM) [12:00]').Trim(); if (-not $time) { $time = '12:00' }
if ($time -notmatch '^([01]?\d|2[0-3]):[0-5]\d$') { Write-Host 'Invalid time.'; exit 1 }
$keepIn = (Read-Host 'How many backups to keep [8]').Trim(); if (-not $keepIn) { $keepIn = '8' }
if ($keepIn -notmatch '^\d{1,3}$' -or [int]$keepIn -lt 1) { Write-Host 'Invalid number.'; exit 1 }

# The task runs a copy kept next to the data, so it keeps working if the extracted install folder is deleted.
$script = Join-Path $app 'backup.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'backup.ps1') -Destination $script -Force
$tr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Silent -Destination `"$folder`" -Keep $keepIn"
if ($monthly) { $sc = @('/SC', 'MONTHLY', '/D', '1') } else { $sc = @('/SC', 'WEEKLY', '/D', 'MON') }
schtasks /Create /TN $taskName @sc /ST $time /TR $tr /F | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'The scheduled task could not be created.'; exit 1 }
# Also run as soon as possible after a missed start (computer was off at the scheduled time).
try { $t = Get-ScheduledTask -TaskName $taskName; $t.Settings.StartWhenAvailable = $true; $t.Settings.DisallowStartIfOnBatteries = $false; $t.Settings.StopIfGoingOnBatteries = $false; Set-ScheduledTask -InputObject $t | Out-Null } catch {}

Write-Host ''
Write-Host ('Done. A backup will be saved to {0}' -f $folder)
Write-Host ('  {0} at {1}, keeping the newest {2}.' -f $(if ($monthly) { 'on the 1st of every month' } else { 'every Monday' }), $time, $keepIn)
Write-Host 'The task runs under your Windows account while you are signed in, so the network folder must be reachable from it.'
Write-Host 'Run Schedule-Backup.bat again to change or remove it. The log is: %LOCALAPPDATA%\RenewalLedger\scheduled-backup.log'
Write-Host ''
$now = Read-Host 'Run a test backup now? (Y/N)'
if ($now -match '^[Yy]') { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Silent -Destination $folder -Keep ([int]$keepIn); Write-Host (Get-Content (Join-Path $app 'scheduled-backup.log') -Tail 1) }
