#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'
$root = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Run inside a git repository.' }
$script = if ($env:XENOCI_BUILD_SCRIPT) { $env:XENOCI_BUILD_SCRIPT } else { 'bash ci.sh' }
$arguments = @('build', '--dir', $root, '--script', $script)
& xenocast @arguments
exit $LASTEXITCODE
