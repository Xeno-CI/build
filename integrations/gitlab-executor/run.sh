#!/usr/bin/env bash
# GitLab custom executor, run stage: run.sh <script-path> <stage>.
# The runner's own stages (get_sources, artifacts, cache) run here on the runner host, so git, caches and
# artifacts behave as with the shell executor. Only the job's script (stage build_script / step_script)
# goes to the rented Mac: the checked-out project folder is uploaded and XENOCI_BUILD_SCRIPT runs in it
# (default: bash ci.sh). The Mac never sees the runner's generated script or its job token.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
XENOCI_LOG_PREFIX=xenoci-executor
source "$ROOT/xenoci.sh"
script_path="${1:?usage: run.sh <script-path> <stage>}"
stage="${2:-}"
case "$stage" in
  build_script|step_script|step_*) ;;
  *) exec bash "$script_path" ;;
esac
dir="${CUSTOM_ENV_CI_PROJECT_DIR:?CUSTOM_ENV_CI_PROJECT_DIR is not set (run under GitLab Runner)}"
xenoci_run "$dir" "${CUSTOM_ENV_CI_PROJECT_NAME:-gitlab}" "${XENOCI_BUILD_SCRIPT:-${CUSTOM_ENV_XENOCI_BUILD_SCRIPT:-bash ci.sh}}" \
  "${CUSTOM_ENV_CI_MERGE_REQUEST_IID:-}" "${CUSTOM_ENV_CI_COMMIT_SHA:-}"
case "$XENOCI_OUTCOME" in
  success) exit 0 ;;
  build_failure) exit "${BUILD_FAILURE_EXIT_CODE:-1}" ;;
  *) exit "${SYSTEM_FAILURE_EXIT_CODE:-1}" ;;
esac
