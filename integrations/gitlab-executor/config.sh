#!/usr/bin/env bash
# GitLab custom executor, config stage: tell the runner where job files live and who the driver is.
set -euo pipefail
printf '{"builds_dir":"%s","cache_dir":"%s","builds_dir_is_shared":false,"driver":{"name":"XenoCI rental executor","version":"2.0.0"}}\n' \
  "${XENOCI_BUILDS_DIR:-/tmp/xenoci-gitlab/builds}" "${XENOCI_CACHE_DIR:-/tmp/xenoci-gitlab/cache}"
