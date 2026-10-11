#!/usr/bin/env bash
# Jenkins step: upload the job's checkout to XenoCI, run XENOCI_BUILD_SCRIPT (default: bash ci.sh) on a
# rented Mac, stream the log and exit with the build's result.
set -euo pipefail

API_URL="${XENOCI_API_URL:-https://xenoci.com/api/ci/v1}"
API_URL="${API_URL%/}"
# XenoCast 1.4: a CI token (XENOCAST_TOKEN, from `xenocast token --ci`) is exchanged at /session/refresh for a short
# access token kept in this process only; the token goes to curl on stdin, never in arguments or output. API keys are retired.
if [ -n "${XENOCI_API_KEY:-}${XENO_API_KEY:-}" ]; then printf '%s\n' "xenoci: API 키는 종료되었습니다: xenocast token --ci 로 CI 토큰을 만들어 XENOCAST_TOKEN 시크릿에 넣으세요" >&2; exit 2; fi
if [ -z "${XENOCAST_TOKEN:-}" ]; then printf '%s\n' "xenoci: XENOCAST_TOKEN is not set (CI token: xenocast token --ci)" >&2; exit 2; fi
XENOCI_ACCESS_TOKEN=$(printf '{"refresh_token":"%s"}' "$XENOCAST_TOKEN" | curl --silent --show-error -X POST -H 'Content-Type: application/json' --data-binary @- "$API_URL/session/refresh" | sed -n 's/.*"access_token":"\([A-Za-z0-9_-]*\)".*/\1/p') || XENOCI_ACCESS_TOKEN=
if [ -z "$XENOCI_ACCESS_TOKEN" ]; then printf '%s\n' "xenoci: invalid_token: XENOCAST_TOKEN was rejected (revoked or expired); make a new one with xenocast token --ci" >&2; exit 2; fi
SCRIPT="${XENOCI_BUILD_SCRIPT:-bash ci.sh}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo 'xenoci: run inside the Jenkins git checkout' >&2; exit 2; }
COMMIT="${GIT_COMMIT:-$(git -C "$ROOT" rev-parse HEAD)}"
PR="${CHANGE_ID:-}"
[[ "$PR" =~ ^[1-9][0-9]*$ ]] || PR=""

command -v curl >/dev/null || { echo 'xenoci: curl is required' >&2; exit 2; }
command -v node >/dev/null || { echo 'xenoci: node is required' >&2; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
field() { node -e 'let x={};try{x=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{};let v=x;for(const k of process.argv[2].split("."))v=v==null?v:v[k];process.stdout.write(v==null?"":String(v))' "$1" "$2"; }
error_code() { local c; c="$(field "$1" error.code)"; [[ -n "$c" ]] || c="$(field "$1" error)"; echo "${c:-unknown_error}"; }
call() {
  curl --silent --show-error -o "$1" -w '%{http_code}' -H "Authorization: Bearer ${XENOCI_ACCESS_TOKEN}" -H 'XenoCI-Error-Format: 2' "${@:2}"
}

# 1. Source: the committed tree at HEAD (what Jenkins checked out), as one gzip tar.
git -C "$ROOT" archive --format=tar HEAD | gzip -c >"$tmp/source.tar.gz"
project="$(printf '%s' "$(basename "$ROOT")" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-64)"
status="$(call "$tmp/upload.json" -X POST -H 'Content-Type: application/gzip' --data-binary "@$tmp/source.tar.gz" "$API_URL/uploads/tar?project=$project")" \
  || { echo 'xenoci: upload request failed' >&2; exit 1; }
[[ "$status" == 2* ]] || { echo "xenoci: upload failed ($(error_code "$tmp/upload.json"))" >&2; exit 1; }
upload_id="$(field "$tmp/upload.json" upload_id)"

# 2. Build: script + uploaded source; pr only when Jenkins gives a PR number (multibranch CHANGE_ID).
node -e 'const [script,upload_id,commit,pr]=process.argv.slice(1);const b={script,upload_id,commit};if(pr)b.pr=Number(pr);process.stdout.write(JSON.stringify(b))' \
  "$SCRIPT" "$upload_id" "$COMMIT" "$PR" >"$tmp/build-request.json"
status="$(call "$tmp/build.json" -X POST -H 'Content-Type: application/json' --data-binary "@$tmp/build-request.json" "$API_URL/builds")" \
  || { echo 'xenoci: build submission request failed' >&2; exit 1; }
[[ "$status" == 2* ]] || { echo "xenoci: build submission failed ($(error_code "$tmp/build.json"))" >&2; exit 1; }
build_id="$(field "$tmp/build.json" id)"
echo "xenoci: submitted build $build_id for commit $COMMIT${PR:+ (PR $PR)}"

# 3. Log: X-Next-Offset is the next byte offset; X-Build-State / X-Exit-Code come with every chunk.
header() { tr -d '\r' <"$tmp/headers" | awk -v k="$1" -F': ' 'tolower($1)==k{print $2}' | tail -1; }
offset=0
while :; do
  curl --silent --show-error --fail -D "$tmp/headers" -o "$tmp/chunk" -H "Authorization: Bearer ${XENOCI_ACCESS_TOKEN}" \
    "$API_URL/builds/$build_id/log?format=text&offset=$offset&wait=20" || { echo 'xenoci: log request failed' >&2; exit 1; }
  cat "$tmp/chunk"
  offset="$(header x-next-offset)"; state="$(header x-build-state)"
  case "$state" in
    succeeded) echo "xenoci: build $build_id succeeded"; exit 0 ;;
    failed|cancelled|expired)
      call "$tmp/final.json" "$API_URL/builds/$build_id" >/dev/null || true
      echo "xenoci: build $state: $(field "$tmp/final.json" failure.summary)" >&2
      code="$(header x-exit-code)"; [[ "$code" =~ ^[1-9][0-9]?[0-9]?$ && "$code" -le 255 ]] && exit "$code"; exit 1 ;;
  esac
done
