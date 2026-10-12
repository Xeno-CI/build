# XenoCast CLI installer for Windows PowerShell 5.1+ / pwsh:
#   irm https://github.com/Xeno-CI/xenocast/releases/latest/download/install.ps1 | iex
# (the old address under Xeno-CI/build/releases serves this same file). Downloads xenocast-windows-x64.exe from
# Xeno-CI/xenocast, verifies it against SHA256SUMS, installs it as xenocast.exe plus a copy named xenoci.exe,
# then runs the installed executable as `setup --no-tui --runner2 --from-installer`: with an API key it checks and saves the key
# and registers `xenocast mcp` with the installed AI agents.
#   $env:XENOCI_API_KEY="xci_live_..."; irm .../install.ps1 | iex   the one line from the console (key in the environment)
#   no key: setup prints the next step and the install still succeeds
#   -NoSetup or $env:XENOCAST_NO_SETUP=1   install only
# Unknown arguments fail before any download. When this script is piped into iex, setup does not read that pipe.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$noSetup = $env:XENOCAST_NO_SETUP -eq '1'
foreach ($arg in @($args)) {
  if ($arg -eq '-NoSetup') { $noSetup = $true }
  else { throw "xenocast: unknown argument: $arg" }
}
$version = if ($env:XENOCAST_VERSION) { $env:XENOCAST_VERSION } elseif ($env:XENOCI_VERSION) { $env:XENOCI_VERSION } else { 'latest' }
$hostBase = if ($env:XENOCAST_INSTALL_BASE) { $env:XENOCAST_INSTALL_BASE.TrimEnd('/') } else { 'https://github.com' }
$mirror = if ($env:XENOCI_BASE_URL) { $env:XENOCI_BASE_URL.TrimEnd('/') } else { $null }
$base = if ($mirror) { $mirror } elseif ($version -eq 'latest') { "$hostBase/Xeno-CI/xenocast/releases/latest/download" } else { "$hostBase/Xeno-CI/xenocast/releases/download/$version" }
$dir = if ($env:XENOCI_INSTALL_DIR) { $env:XENOCI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'xenoci\bin' }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$asset = 'xenocast-windows-x64.exe'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("xenocast-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
$installed = Join-Path $dir 'xenocast.exe'
try {
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile (Join-Path $tmp $asset)
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS')
  $line = Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { ($_ -split '\s+')[1] -in @($asset, "*$asset") }
  if (-not $line) { throw "$asset not listed in SHA256SUMS" }
  $want = ($line -split '\s+')[0].ToLower()
  $got = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $asset)).Hash.ToLower()
  if ($got -ne $want) { throw "checksum mismatch for $asset (expected $want, got $got)" }
  $head = Get-Content -Raw -TotalCount 1 (Join-Path $tmp $asset) -ErrorAction SilentlyContinue
  if (-not $head) { $head = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes((Join-Path $tmp $asset))[0..([Math]::Min(65535, ((Get-Item (Join-Path $tmp $asset)).Length - 1)))]) }
  $mods = [regex]::Matches($head, "from '\./([A-Za-z0-9_.-]+)'") | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  foreach ($mod in $mods) {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$mod" -OutFile (Join-Path $tmp $mod)
    $mline = Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { ($_ -split '\s+')[1] -in @($mod, "*$mod") }
    if (-not $mline) { throw "$mod not listed in SHA256SUMS" }
    $mwant = ($mline -split '\s+')[0].ToLower()
    $mgot = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $mod)).Hash.ToLower()
    if ($mgot -ne $mwant) { throw "checksum mismatch for $mod (expected $mwant, got $mgot)" }
    Copy-Item -Force (Join-Path $tmp $mod) (Join-Path $dir $mod)
  }
  Copy-Item -Force (Join-Path $tmp $asset) (Join-Path $dir 'xenoci.exe')
  Move-Item -Force (Join-Path $tmp $asset) $installed
  & $installed --version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "xenocast: installed executable does not run" }
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
Write-Host "xenocast installed: $installed (old name: xenoci.exe)"
if (-not (($env:PATH -split ';') -contains $dir)) {
  [Environment]::SetEnvironmentVariable('PATH', "$dir;" + [Environment]::GetEnvironmentVariable('PATH', 'User'), 'User')
  $env:PATH = "$dir;$env:PATH"
  Write-Host "added to the user PATH: $dir"
}
if (-not $noSetup) {
  # Start-Process requires an existing input file, not the Windows NUL device.
  # A direct -File run returns setup's code. irm|iex has no script path, so throw instead of exit: exit
  # there would close the caller's interactive shell, while the thrown error stays visible.
  $emptyInput = [IO.Path]::GetTempFileName()
  try {
    $setup = Start-Process -FilePath $installed -ArgumentList @('setup', '--no-tui', '--runner2', '--from-installer') -WorkingDirectory $dir -NoNewWindow -Wait -PassThru -RedirectStandardInput $emptyInput
  } finally { Remove-Item -Force $emptyInput }
  if ($setup.ExitCode -ne 0) {
    if ($PSCommandPath) { exit $setup.ExitCode }
    throw "xenocast setup exited $($setup.ExitCode)"
  }
}
