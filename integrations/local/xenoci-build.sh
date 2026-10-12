#!/bin/sh
set -eu
root=$(git rev-parse --show-toplevel)
exec xenocast build --dir "$root" --script "${XENOCI_BUILD_SCRIPT:-bash ci.sh}"
