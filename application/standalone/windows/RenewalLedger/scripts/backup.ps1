$dest = Join-Path $env:LOCALAPPDATA 'RenewalLedger'
$data = Join-Path $dest 'data'
if (-not (Test-Path $data)) { Write-Host 'No saved data found yet.'; exit 1 }
Write-Host 'Close PROCURE360 first, so every file can be copied.'
Read-Host 'Press Enter to continue'
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$out = Join-Path ([Environment]::GetFolderPath('MyDocuments')) "RenewalLedger-backup-$stamp.zip"
try {
  Compress-Archive -Path (Join-Path $data '*') -DestinationPath $out -Force
  Write-Host "Backup saved: $out"
} catch {
  Write-Host 'Backup failed. Make sure PROCURE360 is closed and try again.'
  exit 1
}
