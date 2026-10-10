#!/usr/bin/env bash
set -euo pipefail

api="${XENOCI_API_URL:-https://xenoci.com}"
api="${api%/}/api/ci/v1"
# XenoCast 1.4: a CI token (XENOCAST_TOKEN, from `xenocast token --ci`) is exchanged at /session/refresh for a short
# access token kept in this process only; the token goes to curl on stdin, never in arguments or output. API keys are retired.
if [ -n "${XENOCI_API_KEY:-}${XENO_API_KEY:-}" ]; then printf '%s\n' "xenoci: API 키는 종료되었습니다: xenocast token --ci 로 CI 토큰을 만들어 XENOCAST_TOKEN 시크릿에 넣으세요" >&2; exit 2; fi
if [ -z "${XENOCAST_TOKEN:-}" ]; then printf '%s\n' "xenoci: XENOCAST_TOKEN is not set (CI token: xenocast token --ci)" >&2; exit 2; fi
XENOCI_ACCESS_TOKEN=$(printf '{"refresh_token":"%s"}' "$XENOCAST_TOKEN" | curl --silent --show-error -X POST -H 'Content-Type: application/json' --data-binary @- "$api/session/refresh" | sed -n 's/.*"access_token":"\([A-Za-z0-9_-]*\)".*/\1/p') || XENOCI_ACCESS_TOKEN=
if [ -z "$XENOCI_ACCESS_TOKEN" ]; then printf '%s\n' "xenoci: invalid_token: XENOCAST_TOKEN was rejected (revoked or expired); make a new one with xenocast token --ci" >&2; exit 2; fi

src="${BUILD_SOURCESDIRECTORY:-$PWD}"
script="${XENOCI_BUILD_SCRIPT:-bash ci.sh}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Source: the checked-out commit, uploaded as one gzip tar (works for private Azure Repos too).
git -C "$src" archive --format=tar HEAD | gzip -c >"$work/source.tar.gz"
project="$(printf '%s' "${BUILD_REPOSITORY_NAME:-$(basename "$src")}" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-64)"
if ! status="$(curl --silent --show-error --output "$work/upload.json" --write-out '%{http_code}' \
  -H "Authorization: Bearer ${XENOCI_ACCESS_TOKEN}" -H 'XenoCI-Error-Format: 2' -H 'Content-Type: application/gzip' \
  -X POST "$api/uploads/tar?project=$project" --data-binary "@$work/source.tar.gz")"; then
  echo 'XenoCI upload failed: network_error' >&2
  exit 1
fi
if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
  code="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.error?.code||j.error||"upload_failed")}catch{console.log("upload_failed")}})' <"$work/upload.json")"
  echo "XenoCI upload failed: $code" >&2
  exit 1
fi

body="$(UPLOAD_JSON="$work/upload.json" SCRIPT="$script" node -e '
  const upload = JSON.parse(require("fs").readFileSync(process.env.UPLOAD_JSON, "utf8"));
  const body = { upload_id: upload.upload_id, commit: process.env.BUILD_SOURCEVERSION, script: process.env.SCRIPT };
  const pr = process.env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER || "";
  if (/^[1-9][0-9]*$/.test(pr)) body.pr = Number(pr);
  process.stdout.write(JSON.stringify(body));
')"

response_file="$work/build.json"
if ! status="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' \
  -H "Authorization: Bearer ${XENOCI_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'XenoCI-Error-Format: 2' \
  -X POST "$api/builds" --data "$body")"; then
  echo 'XenoCI build submission failed: network_error' >&2
  exit 1
fi
if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
  code="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.error?.code||j.error||"submission_failed")}catch{console.log("submission_failed")}})' <"$response_file")"
  echo "XenoCI build submission failed: $code" >&2
  exit 1
fi
build_id="$(node -e 'const b=JSON.parse(process.argv[1]);if(!b.id)process.exit(2);process.stdout.write(String(b.id))' "$(<"$response_file")")"
echo "XenoCI build: $build_id"

while true; do
  response_file="$work/wait.json"
  if ! status="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' \
    -H "Authorization: Bearer ${XENOCI_ACCESS_TOKEN}" \
    -H 'XenoCI-Error-Format: 2' \
    "$api/builds/$build_id/wait?timeout=60")"; then
    echo 'XenoCI build wait failed: network_error' >&2
    exit 1
  fi
  if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
    code="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.error?.code||j.error||"wait_failed")}catch{console.log("wait_failed")}})' <"$response_file")"
    echo "XenoCI build wait failed: $code" >&2
    exit 1
  fi
  result="$(<"$response_file")"
  state="$(node -e 'const r=JSON.parse(process.argv[1]);const b=r.build||r;process.stdout.write(String(b.state||""))' "$result")"
  case "$state" in
    succeeded) echo "XenoCI build succeeded: $build_id"; exit 0 ;;
    failed|cancelled|expired)
      node -e 'const r=JSON.parse(process.argv[1]);const b=r.build||r;const f=b.failure||{};console.error(`XenoCI build ${b.state}: ${f.summary||f.reason_code||"no failure summary"}`)' "$result"
      exit 1
      ;;
    queued|running|assigned|uploading) ;;
    *) echo "Unexpected XenoCI build state: $state" >&2; exit 1 ;;
  esac
done
