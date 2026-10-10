#!/bin/sh
set -eu

fail() { printf '%s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || fail 'curl is required'
command -v git >/dev/null 2>&1 || fail 'git is required'
command -v gzip >/dev/null 2>&1 || fail 'gzip is required'
command -v tar >/dev/null 2>&1 || fail 'tar is required'
command -v node >/dev/null 2>&1 || fail 'node is required'
root=$(git rev-parse --show-toplevel 2>/dev/null) || fail 'Run inside a git repository.'
commit=$(git -C "$root" rev-parse HEAD)
base=${XENOCI_API_URL:-https://xenoci.com}
base=${base%/}/api/ci/v1
# XenoCast 1.4: a CI token (XENOCAST_TOKEN, from `xenocast token --ci`) is exchanged at /session/refresh for a short
# access token kept in this process only; the token goes to curl on stdin, never in arguments or output. API keys are retired.
if [ -n "${XENOCI_API_KEY:-}${XENO_API_KEY:-}" ]; then printf '%s\n' "xenoci: API 키는 종료되었습니다: xenocast token --ci 로 CI 토큰을 만들어 XENOCAST_TOKEN 시크릿에 넣으세요" >&2; exit 1; fi
if [ -z "${XENOCAST_TOKEN:-}" ]; then printf '%s\n' "xenoci: XENOCAST_TOKEN is not set (CI token: xenocast token --ci)" >&2; exit 1; fi
XENOCI_ACCESS_TOKEN=$(printf '{"refresh_token":"%s"}' "$XENOCAST_TOKEN" | curl --silent --show-error -X POST -H 'Content-Type: application/json' --data-binary @- "$base/session/refresh" | sed -n 's/.*"access_token":"\([A-Za-z0-9_-]*\)".*/\1/p') || XENOCI_ACCESS_TOKEN=
if [ -z "$XENOCI_ACCESS_TOKEN" ]; then printf '%s\n' "xenoci: invalid_token: XENOCAST_TOKEN was rejected (revoked or expired); make a new one with xenocast token --ci" >&2; exit 1; fi
build_result_query=
[ -z "${XENOCI_TEST_RESULT:-}" ] || build_result_query="?result=$XENOCI_TEST_RESULT"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/xenoci-local.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

git -C "$root" archive --format=tar HEAD | gzip -c >"$tmp/source.tar.gz"
upload_url="$base/uploads/tar?project=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "${XENOCI_PROJECT:-$(basename "$root")}")"
curl --fail-with-body --silent --show-error -X POST "$upload_url" \
  -H "Authorization: Bearer ${XENOCI_ACCESS_TOKEN}" \
  -H 'XenoCI-Error-Format: 2' -H 'Content-Type: application/gzip' \
  --data-binary "@$tmp/source.tar.gz" -o "$tmp/upload.json" || fail "Upload failed: $(cat "$tmp/upload.json" 2>/dev/null || true)"
upload_id=$(node -e 'const x=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(x.upload_id||x.id||"")' "$tmp/upload.json")
[ -n "$upload_id" ] || fail "Upload response has no upload_id: $(cat "$tmp/upload.json")"

node - "$tmp/build.json" "$commit" "${XENOCI_PR:-}" "${XENOCI_BUILD_SCRIPT:-bash ci.sh}" "$upload_id" <<'NODE'
const fs = require('fs');
const [, , out, commit, pr, script, upload_id] = process.argv;
const build = { upload_id, commit, script };
if (pr && !/^[1-9][0-9]*$/.test(pr)) { console.error(`XENOCI_PR must be a PR number, got: ${pr}`); process.exit(2); }
if (pr) build.pr = Number(pr);
fs.writeFileSync(out, JSON.stringify(build));
NODE
curl --fail-with-body --silent --show-error -X POST "$base/builds$build_result_query" \
  -H "Authorization: Bearer ${XENOCI_ACCESS_TOKEN}" \
  -H 'XenoCI-Error-Format: 2' -H 'Content-Type: application/json' \
  --data-binary "@$tmp/build.json" -o "$tmp/build.json.response" || fail "Build submission failed: $(cat "$tmp/build.json.response" 2>/dev/null || true)"
build_id=$(node -e 'const x=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(x.id||"")' "$tmp/build.json.response")
[ -n "$build_id" ] || fail "Build response has no id: $(cat "$tmp/build.json.response")"
printf 'Build submitted: %s\n' "$build_id"

while :; do
  curl --fail-with-body --silent --show-error "$base/builds/$build_id/wait?timeout=60" \
    -H "Authorization: Bearer ${XENOCI_ACCESS_TOKEN}" -H 'XenoCI-Error-Format: 2' -o "$tmp/status.json" || fail "Build wait failed: $(cat "$tmp/status.json" 2>/dev/null || true)"
  state=$(node -e 'const x=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(x.build?.state||x.state||"")' "$tmp/status.json")
  case "$state" in succeeded|failed|cancelled|expired) break;; esac
done
printf 'Build status: %s\n' "$state"
if [ "$state" != succeeded ]; then
  node - "$tmp/status.json" <<'NODE'
const x = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const b = x.build || x;
const f = b.failure || x.failure;
console.error('Build failure summary: ' + (f?.summary || f?.reason_code || b.error || `state=${b.state}`));
NODE
  exit "$(node -e 'const x=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const b=x.build||x; process.stdout.write(String(Number.isInteger(b.exit_code)&&b.exit_code!==0?Math.min(255,b.exit_code):1))' "$tmp/status.json")"
fi
exit 0
