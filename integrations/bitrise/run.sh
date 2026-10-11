#!/usr/bin/env bash
set -euo pipefail

API_BASE="${XENO_API_BASE_URL:-https://xenoci.com/api/ci/v1}"
API_BASE="${API_BASE%/}"
# XenoCast 1.4: a CI token (XENOCAST_TOKEN, from `xenocast token --ci`) is exchanged at /session/refresh for a short
# access token kept in this process only; the token goes to curl on stdin, never in arguments or output. API keys are retired.
if [ -n "${XENOCI_API_KEY:-}${XENO_API_KEY:-}" ]; then printf '%s\n' "xenoci: API 키는 종료되었습니다: xenocast token --ci 로 CI 토큰을 만들어 XENOCAST_TOKEN 시크릿에 넣으세요" >&2; exit 2; fi
if [ -z "${XENOCAST_TOKEN:-}" ]; then printf '%s\n' "xenoci: XENOCAST_TOKEN is not set (CI token: xenocast token --ci)" >&2; exit 2; fi
XENOCI_ACCESS_TOKEN=$(printf '{"refresh_token":"%s"}' "$XENOCAST_TOKEN" | curl --silent --show-error -X POST -H 'Content-Type: application/json' --data-binary @- "${API_BASE}/session/refresh" | sed -n 's/.*"access_token":"\([A-Za-z0-9_-]*\)".*/\1/p') || XENOCI_ACCESS_TOKEN=
if [ -z "$XENOCI_ACCESS_TOKEN" ]; then printf '%s\n' "xenoci: invalid_token: XENOCAST_TOKEN was rejected (revoked or expired); make a new one with xenocast token --ci" >&2; exit 2; fi

command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

src="${BITRISE_SOURCE_DIR:-$PWD}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
api_error() { jq -r '(.error.code? // .error? // .error_detail.code? // "request_failed") | tostring' "$1" 2>/dev/null || echo request_failed; }

# Source: the checked-out commit (Git Clone step), uploaded as one gzip tar — private repos need nothing extra.
git -C "$src" archive --format=tar HEAD | gzip -c >"$work/source.tar.gz"
project="$(printf '%s' "${BITRISE_APP_TITLE:-$(basename "$src")}" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-64)"
if ! curl --silent --show-error --fail-with-body \
  -H "Authorization: Bearer ${XENOCI_ACCESS_TOKEN}" -H 'XenoCI-Error-Format: 2' -H 'Content-Type: application/gzip' \
  --data-binary "@$work/source.tar.gz" "${API_BASE}/uploads/tar?project=${project}" -o "$work/upload.json"; then
  echo "XenoCI upload failed ($(api_error "$work/upload.json"))" >&2
  exit 1
fi

pr="${BITRISE_PULL_REQUEST:-}"
[[ "$pr" =~ ^[1-9][0-9]*$ ]] || pr=""
body="$(jq -n \
  --arg script "${XENO_BUILD_SCRIPT:-bash ci.sh}" \
  --arg upload "$(jq -r '.upload_id' "$work/upload.json")" \
  --arg commit "${BITRISE_GIT_COMMIT:-}" \
  --arg pr "$pr" \
  '({script:$script, upload_id:$upload} + (if $commit == "" then {} else {commit:$commit} end) + (if $pr == "" then {} else {pr:($pr|tonumber)} end))')"

response_file="$work/build.json"
if ! curl --silent --show-error --fail-with-body \
  -H "Authorization: Bearer ${XENOCI_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'XenoCI-Error-Format: 2' \
  --data "$body" "${API_BASE}/builds" -o "$response_file"; then
  echo "XenoCI build submission failed ($(api_error "$response_file"))" >&2
  exit 1
fi
response="$(<"$response_file")"

build_id="$(printf '%s' "$response" | jq -er '.build.id // .build_id // .id' 2>/dev/null)" || {
  code="$(python3 -c 'import json,sys; x=json.load(sys.stdin); e=x.get("error"); print((e.get("code") if isinstance(e,dict) else e) or x.get("error_detail",{}).get("code") or "")' <<<"$response" 2>/dev/null || true)"
  if [[ -n "$code" ]]; then echo "XenoCI build submission failed (${code})" >&2; else echo "XenoCI response did not include build_id" >&2; fi
  exit 1
}
echo "XenoCI build submitted: ${build_id}"

while :; do
  wait_file="$(mktemp)"
  if curl --silent --show-error --fail-with-body \
    -H "Authorization: Bearer ${XENOCI_ACCESS_TOKEN}" \
    -H 'XenoCI-Error-Format: 2' \
    "${API_BASE}/builds/${build_id}/wait?timeout=60" -o "$wait_file"; then
    result="$(<"$wait_file")"
    rm -f "$wait_file"
    state="$(printf '%s' "$result" | jq -r '.build.state // .state // .status // "unknown"' | tr '[:upper:]' '[:lower:]')"
    case "$state" in
      success|succeeded|passed|completed|complete)
        echo "XenoCI build ${build_id}: ${state}"
        exit 0
        ;;
      failed|failure|error|cancelled|canceled|expired)
        summary="$(printf '%s' "$result" | jq -r '.build.failure.summary // .failure.summary // .failure.message // .message // "Build ended in state: \(.build.state // .state // .status)"')"
        printf 'XenoCI build %s failed: %s\n' "$build_id" "$summary" >&2
        exit 1
        ;;
    esac
  else
    code="$(python3 -c 'import json,sys; x=json.load(open(sys.argv[1])); e=x.get("error"); print((e.get("code") if isinstance(e,dict) else e) or x.get("error_detail",{}).get("code") or "request_failed")' "$wait_file" 2>/dev/null || true)"
    rm -f "$wait_file"
    echo "XenoCI wait failed (${code:-request_failed})" >&2
    exit 1
  fi
done
