param(
  [string]$Destination = '',   # folder (local or network) for the zip; default: Documents
  [switch]$Silent,             # no questions (used by the scheduled task)
  [int]$Keep = 0               # with -Destination: keep only the newest N scheduled backups (0 = keep all)
)
$dest = Join-Path $env:LOCALAPPDATA 'RenewalLedger'
$data = Join-Path $dest 'data'
if (-not (Test-Path $data)) { Write-Host 'No saved data found yet.'; exit 1 }
if (-not $Silent) {
  Write-Host 'Close PROCURE360 first, so every file can be copied.'
  Read-Host 'Press Enter to continue'
}
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$scheduled = [bool]$Destination
if (-not $Destination) { $Destination = [Environment]::GetFolderPath('MyDocuments') }
$name = if ($scheduled) { "PROCURE360-scheduled-backup-$stamp.zip" } else { "RenewalLedger-backup-$stamp.zip" }
$out = Join-Path $Destination $name
$log = Join-Path $dest 'scheduled-backup.log'
function Log($m) { if ($scheduled) { Add-Content -LiteralPath $log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -ErrorAction SilentlyContinue } }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("p360-" + [guid]::NewGuid().ToString('N'))
try {
  if (-not (Test-Path -LiteralPath $Destination)) { throw "Folder not found: $Destination" }
  # A copy first: the browser may be open and keep some files locked. Locked files are retried once and then skipped.
  & robocopy $data $tmp /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Could not copy the data folder (robocopy code $LASTEXITCODE)." }
  $part = "$out.part"
  Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $part -Force
  Move-Item -LiteralPath $part -Destination $out -Force
  Write-Host "Backup saved: $out"
  Log "OK $out"
  if ($scheduled -and $Keep -gt 0) {
    Get-ChildItem -LiteralPath $Destination -Filter 'PROCURE360-scheduled-backup-*.zip' -File |
      Sort-Object Name -Descending | Select-Object -Skip $Keep |
      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue; Log "Removed old backup $($_.Name)" }
  }
} catch {
  Write-Host "Backup failed: $($_.Exception.Message)"
  Write-Host 'Make sure the folder exists and is reachable, then try again.'
  Log "FAILED $($_.Exception.Message)"
  Remove-Item -LiteralPath "$out.part" -Force -ErrorAction SilentlyContinue
  exit 1
} finally {
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
