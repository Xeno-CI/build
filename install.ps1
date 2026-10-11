# XenoCast CLI installer for Windows PowerShell 5.1+ / pwsh:
#   irm https://github.com/Xeno-CI/xenocast/releases/latest/download/install.ps1 | iex
# (the old address under Xeno-CI/build/releases serves this same file). Downloads xenocast-windows-x64.exe from
# Xeno-CI/xenocast, verifies it against SHA256SUMS and installs it as xenocast.exe, plus a copy named xenoci.exe.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$version = if ($env:XENOCAST_VERSION) { $env:XENOCAST_VERSION } elseif ($env:XENOCI_VERSION) { $env:XENOCI_VERSION } else { 'latest' }
$hostBase = if ($env:XENOCAST_INSTALL_BASE) { $env:XENOCAST_INSTALL_BASE.TrimEnd('/') } else { 'https://github.com' }
$base = if ($version -eq 'latest') { "$hostBase/Xeno-CI/xenocast/releases/latest/download" } else { "$hostBase/Xeno-CI/xenocast/releases/download/$version" }
$dir = if ($env:XENOCI_INSTALL_DIR) { $env:XENOCI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'xenoci\bin' }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$asset = 'xenocast-windows-x64.exe'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("xenocast-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile (Join-Path $tmp $asset)
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS')
  $line = Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { ($_ -split '\s+')[1] -in @($asset, "*$asset") }
  if (-not $line) { throw "$asset not listed in SHA256SUMS" }
  $want = ($line -split '\s+')[0].ToLower()
  $got = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $asset)).Hash.ToLower()
  if ($got -ne $want) { throw "checksum mismatch for $asset (expected $want, got $got)" }
  Copy-Item -Force (Join-Path $tmp $asset) (Join-Path $dir 'xenoci.exe')
  Move-Item -Force (Join-Path $tmp $asset) (Join-Path $dir 'xenocast.exe')
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
Write-Host "xenocast installed: $(Join-Path $dir 'xenocast.exe') (old name: xenoci.exe)"
if (-not (($env:PATH -split ';') -contains $dir)) {
  [Environment]::SetEnvironmentVariable('PATH', "$dir;" + [Environment]::GetEnvironmentVariable('PATH', 'User'), 'User')
  $env:PATH = "$dir;$env:PATH"
  Write-Host "added to the user PATH: $dir"
}
