#!/usr/bin/env bash
set -euo pipefail

api_base="${XENO_API_BASE_URL:-https://xenoci.com/api/ci/v1}"
api_base="${api_base%/}"
: "${XENO_API_KEY:?Set the XENO_API_KEY CircleCI project secret}"
: "${CIRCLE_SHA1:?CircleCI did not provide CIRCLE_SHA1}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
body_file="$tmp/body.json"
error_message() {
  jq -r '.error_detail.message // .error.message // .message // .error_detail.code // .error.code // .error // "Unknown XenoCI API error"' "$body_file" 2>/dev/null || printf '%s\n' 'Unknown XenoCI API error'
}
request() {
  local method="$1" url="$2" data="${3-}" code error_code
  local args=(--silent --show-error --output "$body_file" --write-out '%{http_code}' -X "$method"
    -H "Authorization: Bearer $XENO_API_KEY" -H 'XenoCI-Error-Format: 2' -H 'Accept: application/json')
  if [[ -n "$data" ]]; then args+=(-H 'Content-Type: application/json' --data "$data"); fi
  if ! code="$(curl "${args[@]}" "$url")"; then printf 'XenoCI request failed: network error\n' >&2; return 1; fi
  if [[ ! "$code" =~ ^2[0-9][0-9]$ ]]; then
    error_code="$(jq -r '.error.code // .error_detail.code // .error // "unknown_error"' "$body_file" 2>/dev/null || printf unknown_error)"
    printf 'XenoCI request failed (%s): %s\n' "$error_code" "$(error_message)" >&2
    return 1
  fi
}

# Source: the checked-out commit (`checkout` step), uploaded as one gzip tar — private repos need nothing extra.
git archive --format=tar HEAD | gzip -c >"$tmp/source.tar.gz"
project="$(printf '%s' "${CIRCLE_PROJECT_REPONAME:-$(basename "$PWD")}" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-64)"
if ! code="$(curl --silent --show-error --output "$body_file" --write-out '%{http_code}' -X POST \
  -H "Authorization: Bearer $XENO_API_KEY" -H 'XenoCI-Error-Format: 2' -H 'Content-Type: application/gzip' \
  --data-binary "@$tmp/source.tar.gz" "$api_base/uploads/tar?project=$project")"; then
  echo 'XenoCI upload failed: network error' >&2; exit 1
fi
if [[ ! "$code" =~ ^2[0-9][0-9]$ ]]; then
  echo "XenoCI upload failed ($(jq -r '.error.code // .error_detail.code // .error // "unknown_error"' "$body_file" 2>/dev/null || echo unknown_error)): $(error_message)" >&2; exit 1
fi
upload_id="$(jq -er '.upload_id' "$body_file")"

# CIRCLE_PULL_REQUEST is a URL (…/pull/123); the API takes the number.
pr="${CIRCLE_PULL_REQUEST:-}"; pr="${pr##*/}"
[[ "$pr" =~ ^[1-9][0-9]*$ ]] || pr=""
payload="$(jq -cn --arg commit "$CIRCLE_SHA1" --arg upload "$upload_id" --arg script "${XENO_BUILD_SCRIPT:-bash ci.sh}" --arg pr "$pr" \
  '{script:$script,upload_id:$upload,commit:$commit,queue_until_rental:true} + (if $pr == "" then {} else {pr:($pr|tonumber)} end)')"
request POST "$api_base/builds" "$payload"
build_id="$(jq -er '.id // .build_id // empty' "$body_file")" || { echo 'XenoCI response did not include a build id' >&2; exit 1; }
echo "XenoCI build submitted: $build_id"

while :; do
  request GET "$api_base/builds/$build_id/wait?timeout=60"
  state="$(jq -r '.state // .status // "unknown"' "$body_file")"
  case "$state" in
    succeeded|success|passed) echo "XenoCI build $build_id succeeded"; exit 0 ;;
    failed|cancelled|canceled|expired)
      summary="$(jq -r '.failure.summary // .failure.reason_code // .message // "Build ended in state: \(.state // .status // "unknown")"' "$body_file")"
      echo "XenoCI build $build_id $state: $summary" >&2; exit 1 ;;
    queued|running|unknown) ;;
    *) echo "XenoCI build $build_id returned unrecognized state: $state" >&2; exit 1 ;;
  esac
done
