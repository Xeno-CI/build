#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'
# XenoCast 1.4: a CI token (XENOCAST_TOKEN, from `xenocast token --ci`) is exchanged for a short access token; API keys are retired.
if ($env:XENOCI_API_KEY -or $env:XENO_API_KEY) { throw 'API keys are retired: make a CI token with xenocast token --ci and put it in the XENOCAST_TOKEN secret' }  # ASCII-safe for Windows PowerShell 5.1 without a BOM
if (-not $env:XENOCAST_TOKEN) { throw 'XENOCAST_TOKEN is not set (CI token: xenocast token --ci)' }
$root = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Run inside a git repository.' }
$commit = (& git -C $root rev-parse HEAD).Trim()
$base = if ($env:XENOCI_API_URL) { $env:XENOCI_API_URL.TrimEnd('/') } else { 'https://xenoci.com' }
$base += '/api/ci/v1'
try { $access = (Invoke-RestMethod -Method Post -Uri "$base/session/refresh" -ContentType 'application/json' -Body (@{ refresh_token = $env:XENOCAST_TOKEN } | ConvertTo-Json -Compress)).access_token }
catch { throw 'invalid_token: XENOCAST_TOKEN was rejected (revoked or expired); make a new one with xenocast token --ci' }
if (-not $access) { throw 'invalid_token: XENOCAST_TOKEN was rejected (revoked or expired); make a new one with xenocast token --ci' }
$project = if ($env:XENOCI_PROJECT) { $env:XENOCI_PROJECT } else { Split-Path $root -Leaf }
$archive = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString() + '.tar.gz')
try {
  # git writes the gzip tar itself: PowerShell pipes are text and would corrupt binary files.
  & git -C $root archive --format=tar.gz -o $archive HEAD
  if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }
  $headers = @{ Authorization = "Bearer $access"; 'XenoCI-Error-Format' = '2' }
  $upload = Invoke-RestMethod -Method Post -Uri "$base/uploads/tar?project=$([uri]::EscapeDataString($project))" -Headers $headers -ContentType 'application/gzip' -InFile $archive
  $script = if ($env:XENOCI_BUILD_SCRIPT) { $env:XENOCI_BUILD_SCRIPT } else { 'bash ci.sh' }
  $body = @{ upload_id = $(if ($upload.upload_id) { $upload.upload_id } else { $upload.id }); commit = $commit; script = $script }
  if ($env:XENOCI_PR) {
    if ($env:XENOCI_PR -notmatch '^[1-9][0-9]*$') { throw "XENOCI_PR must be a PR number, got: $env:XENOCI_PR" }
    $body.pr = [long]$env:XENOCI_PR
  }
  $build = Invoke-RestMethod -Method Post -Uri "$base/builds" -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress)
  Write-Host "Build submitted: $($build.id)"
  do {
    $result = Invoke-RestMethod -Method Get -Uri "$base/builds/$($build.id)/wait?timeout=60" -Headers $headers
    $state = if ($result.build.state) { $result.build.state } else { $result.state }
  } while ($state -notin @('succeeded', 'failed', 'cancelled', 'expired'))
  Write-Host "Build status: $state"
  if ($state -ne 'succeeded') {
    $b = if ($result.build) { $result.build } else { $result }
    $failure = if ($b.failure.summary) { $b.failure.summary } elseif ($b.failure.reason_code) { $b.failure.reason_code } else { "state=$state" }
    [Console]::Error.WriteLine("Build failure summary: $failure")
    exit $(if ($b.exit_code -and $b.exit_code -ne 0) { [Math]::Min(255, $b.exit_code) } else { 1 })
  }
} catch {
  $detail = $_.ErrorDetails.Message
  if ($detail) {
    try { $e = $detail | ConvertFrom-Json; if ($e.error.code) { Write-Error "XenoCI $($e.error.code): $($e.error.message)" }; if ($e.error -is [string]) { Write-Error "XenoCI $($e.error)" } } catch { }
  }
  throw
} finally {
  Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
}
