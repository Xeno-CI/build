#!/usr/bin/env bash
set -euo pipefail
: "${XENOCI_API_KEY:?Set the Jenkins secret XENOCI_API_KEY to an API key from the XenoCI console}"
export XENOCI_API_URL="${XENOCI_API_URL:-https://xenoci.com}"
XENOCI_API_URL="${XENOCI_API_URL%/api/ci/v1}"
root="$(git rev-parse --show-toplevel)"
exec xenocast build --dir "$root" --script "${XENOCI_BUILD_SCRIPT:-bash ci.sh}"
