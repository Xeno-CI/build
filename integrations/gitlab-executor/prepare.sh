#!/usr/bin/env bash
# GitLab custom executor, prepare stage: nothing to create (each job gets a new VM); this only checks
# the tools and that the API key works, so a bad key fails the job as a system failure before any step runs.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
XENOCI_LOG_PREFIX=xenoci-executor
source "$ROOT/xenoci.sh"
xenoci_require || exit "${SYSTEM_FAILURE_EXIT_CODE:-1}"
XENOCI_API_URL="${XENOCI_API_URL%/api/ci/v1}" xenocast whoami --json >/dev/null || exit "${SYSTEM_FAILURE_EXIT_CODE:-1}"
