#!/usr/bin/env bash
# Shared GitLab/Buildkite adapter. The CLI sends XENOCI_API_KEY as Bearer to /api/runner/v1, filters uploads and handles cancellation.
# Keep the installed copies byte-identical to this file.
XENOCI_API_URL="${XENOCI_API_URL:-https://xenoci.com}"
XENOCI_LOG_PREFIX="${XENOCI_LOG_PREFIX:-xenoci}"
XENOCI_BUILD_ID=""
XENOCI_OUTCOME=""
XENOCI_EXIT_CODE=1
xenoci_log() { printf '%s: %s\n' "$XENOCI_LOG_PREFIX" "$*" >&2; }
xenoci_require() {
  [[ -n "${XENOCI_API_KEY:-}" ]] || { xenoci_log 'Set XENOCI_API_KEY to an API key from the XenoCI console'; return 1; }
  command -v xenocast >/dev/null || { xenoci_log 'Install xenocast from https://github.com/Xeno-CI/xenocast'; return 1; }
  command -v jq >/dev/null || { xenoci_log 'jq is required'; return 1; }
}
xenoci_run() {
  local dir="$1" script="$2" tmp pid code
  XENOCI_OUTCOME=system_failure; XENOCI_EXIT_CODE=1; XENOCI_BUILD_ID=""
  xenoci_require || return 0
  local args=(build --dir "$dir" --script "$script" --json)
  [[ -z "${XENOCI_XCODE:-}" ]] || args+=(--xcode "$XENOCI_XCODE")
  [[ -z "${XENOCI_TIMEOUT_MIN:-}" ]] || args+=(--timeout "$XENOCI_TIMEOUT_MIN")
  tmp="$(mktemp)"
  XENOCI_API_URL="${XENOCI_API_URL%/api/ci/v1}" xenocast "${args[@]}" >"$tmp" &
  pid=$!
  trap 'kill -TERM "$pid" 2>/dev/null || true; wait "$pid" || true; rm -f "$tmp"; exit 143' TERM
  trap 'kill -INT "$pid" 2>/dev/null || true; wait "$pid" || true; rm -f "$tmp"; exit 130' INT
  if wait "$pid"; then code=0; else code=$?; fi
  trap - TERM INT
  XENOCI_BUILD_ID="$(jq -r '.id // empty' "$tmp")"
  if [[ -z "$XENOCI_BUILD_ID" && "$code" != 0 ]]; then jq -r '.error.code // "client_error"' "$tmp" >&2; fi
  XENOCI_EXIT_CODE="$code"
  if [[ "$code" = 0 ]]; then XENOCI_OUTCOME=success
  elif [[ -n "$XENOCI_BUILD_ID" ]]; then XENOCI_OUTCOME=build_failure
  fi
  rm -f "$tmp"
}
