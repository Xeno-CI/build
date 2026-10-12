#!/usr/bin/env bash
set -euo pipefail
: "${XENOCI_API_KEY:?Set the Azure secret XENOCI_API_KEY to an API key from the XenoCI console}"
exec xenocast build --dir "${BUILD_SOURCESDIRECTORY:-$PWD}" --script "${XENOCI_BUILD_SCRIPT:-bash ci.sh}"
