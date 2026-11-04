$dest = Join-Path $env:LOCALAPPDATA 'RenewalLedger'
foreach ($f in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Startup'))) {
  Remove-Item -LiteralPath (Join-Path $f 'Renewal Ledger.lnk') -Force -ErrorAction SilentlyContinue
}
Write-Host 'Shortcuts removed.'
Write-Host "Program and data folder: $dest"
$ans = Read-Host 'Delete the program files AND ALL SAVED DATA? Type DELETE to confirm, or press Enter to keep them'
if ($ans -ceq 'DELETE') {
  Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $dest) { Write-Host 'Some files are in use. Close Renewal Ledger and run this again.' } else { Write-Host 'Everything was deleted.' }
} else {
  Write-Host 'Files and data were kept.'
}
