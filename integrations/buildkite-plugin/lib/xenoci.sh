#!/usr/bin/env bash
# XenoCI rental API client for shell integrations (GitLab custom executor, Buildkite plugin).
#
# One build = upload a folder (gzip tar) -> POST /builds {script, upload_id} -> follow the text log.
# Needs bash, curl, jq, tar, gzip. The key is read from XENOCI_API_KEY and never printed.
#
# xenoci_run sets XENOCI_OUTCOME (success | build_failure | system_failure), XENOCI_EXIT_CODE (the build's
# exit code, or 1) and XENOCI_BUILD_ID, so each CI can map them to its own exit codes.

XENOCI_API_URL="${XENOCI_API_URL:-https://xenoci.com}"
XENOCI_API_BASE="${XENOCI_API_URL%/}/api/ci/v1"
XENOCI_LOG_PREFIX="${XENOCI_LOG_PREFIX:-xenoci}"
XENOCI_BUILD_ID=""
XENOCI_OUTCOME=""
XENOCI_EXIT_CODE=1

xenoci_log() { printf '%s: %s\n' "$XENOCI_LOG_PREFIX" "$*" >&2; }

xenoci_require() {
  [[ -n "${XENOCI_API_KEY:-}" ]] || { xenoci_log 'XENOCI_API_KEY is not set'; return 1; }
  local tool
  for tool in curl jq tar gzip; do command -v "$tool" >/dev/null || { xenoci_log "$tool is required"; return 1; }; done
}

# xenoci_call <out-file> <curl args...>: prints the HTTP status; the body goes to <out-file>.
xenoci_call() {
  curl --silent --show-error --connect-timeout 20 -o "$1" -w '%{http_code}' \
    -H "Authorization: Bearer ${XENOCI_API_KEY}" -H 'XenoCI-Error-Format: 2' "${@:2}"
}

xenoci_error() { jq -r '.error.code // .error_detail.code // .error // "unknown_error" | tostring' "$1" 2>/dev/null || echo unknown_error; }

# xenoci_upload <dir> <project> <tmp-dir>: prints the upload id. File modes travel in the tar, so an
# executable ./ci.sh stays executable on the Mac; the server also skips .git, .build, DerivedData, Pods.
xenoci_upload() {
  local dir="$1" project="$2" tmp="$3" status
  project="$(printf '%s' "$project" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-64)"
  tar -C "$dir" --exclude=./.git -cf - . | gzip -c >"$tmp/source.tar.gz"
  status="$(xenoci_call "$tmp/upload.json" -X POST -H 'Content-Type: application/gzip' \
    --data-binary "@$tmp/source.tar.gz" "$XENOCI_API_BASE/uploads/tar?project=${project:-source}")" || { xenoci_log 'upload request failed'; return 1; }
  [[ "$status" == 2* ]] || { xenoci_log "upload failed ($(xenoci_error "$tmp/upload.json"))"; return 1; }
  jq -er '.upload_id' "$tmp/upload.json"
}

# xenoci_submit <request-json-file> <tmp-dir>: prints the build id (rb_...).
xenoci_submit() {
  local status
  status="$(xenoci_call "$2/build.json" -X POST -H 'Content-Type: application/json' --data-binary "@$1" "$XENOCI_API_BASE/builds")" \
    || { xenoci_log 'build submission request failed'; return 1; }
  [[ "$status" == 2* ]] || { xenoci_log "build submission failed ($(xenoci_error "$2/build.json"))"; return 1; }
  jq -er '.id' "$2/build.json"
}

xenoci_cancel() {
  [[ -n "$1" ]] || return 0
  xenoci_call /dev/null -X POST "$XENOCI_API_BASE/builds/$1/cancel" >/dev/null || true
}

# xenoci_follow <build-id> <tmp-dir>: streams the log to stdout until the build ends; sets XENOCI_OUTCOME.
xenoci_follow() {
  local id="$1" tmp="$2" offset=0 state code
  while :; do
    if ! curl --silent --show-error --fail --connect-timeout 20 --retry 3 --retry-connrefused -D "$tmp/headers" -o "$tmp/chunk" \
      -H "Authorization: Bearer ${XENOCI_API_KEY}" "$XENOCI_API_BASE/builds/$id/log?format=text&offset=$offset&wait=20"; then
      xenoci_log "log request failed for $id"; XENOCI_OUTCOME=system_failure; return
    fi
    cat "$tmp/chunk"
    offset="$(tr -d '\r' <"$tmp/headers" | awk -F': ' 'tolower($1)=="x-next-offset"{v=$2} END{print v}')"
    state="$(tr -d '\r' <"$tmp/headers" | awk -F': ' 'tolower($1)=="x-build-state"{v=$2} END{print v}')"
    case "$state" in
      succeeded) xenoci_log "build $id succeeded"; XENOCI_OUTCOME=success; XENOCI_EXIT_CODE=0; return ;;
      failed|cancelled|expired)
        xenoci_call "$tmp/final.json" "$XENOCI_API_BASE/builds/$id" >/dev/null || true
        xenoci_log "build $id $state: $(jq -r '.failure.summary // "no failure summary"' "$tmp/final.json" 2>/dev/null)"
        code="$(jq -r '.exit_code // empty' "$tmp/final.json" 2>/dev/null)"
        XENOCI_OUTCOME=build_failure; XENOCI_EXIT_CODE=1
        [[ "$code" =~ ^[0-9]+$ && "$code" -ge 1 && "$code" -le 255 ]] && XENOCI_EXIT_CODE="$code"
        return ;;
    esac
    [[ "$offset" =~ ^[0-9]+$ ]] || { xenoci_log "unexpected log response for $id"; XENOCI_OUTCOME=system_failure; return; }
  done
}

# xenoci_run <dir> <project> <script> [pr] [commit]: upload, submit, follow. Optional XENOCI_XCODE and
# XENOCI_TIMEOUT_MIN go into the request. A SIGTERM/SIGINT while waiting (job cancelled in the CI)
# cancels the remote build so the rented Mac is freed.
xenoci_run() {
  local dir="$1" project="$2" script="$3" pr="${4:-}" commit="${5:-}" tmp upload
  XENOCI_OUTCOME=system_failure; XENOCI_EXIT_CODE=1; XENOCI_BUILD_ID=""
  xenoci_require || return 0
  tmp="$(mktemp -d)"
  [[ "$pr" =~ ^[1-9][0-9]*$ ]] || pr=""
  [[ "$commit" =~ ^[0-9a-fA-F]{7,40}$ ]] || commit=""
  if upload="$(xenoci_upload "$dir" "$project" "$tmp")"; then
    jq -n --arg script "$script" --arg upload "$upload" --arg pr "$pr" --arg commit "$commit" \
      --arg xcode "${XENOCI_XCODE:-}" --arg timeout "${XENOCI_TIMEOUT_MIN:-}" \
      '{script:$script, upload_id:$upload}
       + (if $pr == "" then {} else {pr:($pr|tonumber)} end) + (if $commit == "" then {} else {commit:$commit} end)
       + (if $xcode == "" then {} else {xcode:$xcode} end) + (if $timeout == "" then {} else {timeout_min:($timeout|tonumber)} end)' >"$tmp/request.json"
    if XENOCI_BUILD_ID="$(xenoci_submit "$tmp/request.json" "$tmp")"; then
      xenoci_log "build $XENOCI_BUILD_ID submitted"
      trap 'xenoci_log "stopped: cancelling $XENOCI_BUILD_ID"; xenoci_cancel "$XENOCI_BUILD_ID"; exit 143' TERM
      trap 'xenoci_log "stopped: cancelling $XENOCI_BUILD_ID"; xenoci_cancel "$XENOCI_BUILD_ID"; exit 130' INT
      xenoci_follow "$XENOCI_BUILD_ID" "$tmp"
      trap - TERM INT
    fi
  fi
  rm -rf "$tmp"
}
