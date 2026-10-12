#!/usr/bin/env bash
set -euo pipefail
: "${XENOCI_API_KEY:?Set the Bitrise secret XENOCI_API_KEY to an API key from the XenoCI console}"
export XENOCI_API_URL="${XENOCI_API_URL:-${XENO_API_BASE_URL:-https://xenoci.com}}"
XENOCI_API_URL="${XENOCI_API_URL%/api/ci/v1}"
exec xenocast build --dir "${BITRISE_SOURCE_DIR:-$PWD}" --script "${XENO_BUILD_SCRIPT:-bash ci.sh}"
