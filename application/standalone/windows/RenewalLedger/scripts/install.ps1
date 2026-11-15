param([string]$Source)
$ErrorActionPreference = 'Stop'
$dest = Join-Path $env:LOCALAPPDATA 'RenewalLedger'
Write-Host ''
Write-Host 'PROCURE360 - installation'
Write-Host "Install folder: $dest"
Write-Host ''

if (-not (Test-Path (Join-Path $Source 'index.html'))) {
  Write-Host 'ERROR: index.html was not found. Extract the zip first, then run Install.bat from the extracted folder.'
  exit 1
}

$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) {
  Write-Host 'ERROR: Microsoft Edge or Google Chrome was not found. One of them is required.'
  exit 1
}
Write-Host "Browser engine: $browser"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path (Join-Path $Source '*') -Destination $dest -Recurse -Force
Write-Host 'Program files copied.'

# The Excel component (SheetJS 0.20.3) ships inside the package (app\xlsx.full.min.js) and was copied above: no download, works offline.
if (-not (Test-Path (Join-Path $dest 'xlsx.full.min.js'))) { Write-Host 'WARNING: xlsx.full.min.js is missing from the package. Excel import/export will not work.' }

$uri = ([System.Uri](Join-Path $dest 'index.html')).AbsoluteUri
$data = Join-Path $dest 'data'
$launchArgs = "--app=`"$uri`" --user-data-dir=`"$data`" --no-first-run --no-default-browser-check"
$ws = New-Object -ComObject WScript.Shell
function New-Link($folder) {
  Remove-Item -LiteralPath (Join-Path $folder 'Renewal Ledger.lnk') -Force -ErrorAction SilentlyContinue # old name (before 3.2.0)
  $lnk = $ws.CreateShortcut((Join-Path $folder 'PROCURE360.lnk'))
  $lnk.TargetPath = $browser
  $lnk.Arguments = $launchArgs
  $lnk.WorkingDirectory = $dest
  $lnk.IconLocation = (Join-Path $dest 'icon.ico')
  $lnk.Description = 'PROCURE360'
  $lnk.Save()
}
New-Link ([Environment]::GetFolderPath('Desktop'))
New-Link ([Environment]::GetFolderPath('Programs'))
Write-Host 'Shortcuts created on the Desktop and in the Start menu.'

$ans = Read-Host 'Open PROCURE360 automatically when Windows starts, to show due renewals? (Y/N)'
if ($ans -match '^[Yy]') {
  New-Link ([Environment]::GetFolderPath('Startup'))
  Write-Host 'It will open at sign-in.'
}
Write-Host ''
Write-Host 'Done. Open "PROCURE360" from the Desktop or the Start menu.'
