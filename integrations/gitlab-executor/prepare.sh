#!/usr/bin/env bash
# GitLab custom executor, prepare stage: nothing to create. The rented Mac already exists; this only checks
# the tools and that the key works, so a bad key fails the job as a system failure before any step runs.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
XENOCI_LOG_PREFIX=xenoci-executor
source "$ROOT/xenoci.sh"
xenoci_require || exit "${SYSTEM_FAILURE_EXIT_CODE:-1}"
status="$(xenoci_call /dev/null "$XENOCI_API_BASE/status")" || exit "${SYSTEM_FAILURE_EXIT_CODE:-1}"
[[ "$status" == 200 ]] || { xenoci_log "XenoCI API refused the key (HTTP $status)"; exit "${SYSTEM_FAILURE_EXIT_CODE:-1}"; }
