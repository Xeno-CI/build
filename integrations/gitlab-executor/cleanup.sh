#!/usr/bin/env bash
# GitLab custom executor, cleanup stage: nothing to delete. A cancelled job cancels its build in run.sh
# (SIGTERM), and the rented Mac resets its workspace after every build.
exit 0
