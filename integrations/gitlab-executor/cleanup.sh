#!/usr/bin/env bash
# GitLab custom executor, cleanup stage: nothing to delete. A cancelled job cancels its build in run.sh
# (SIGTERM), and the VM is deleted after every job.
exit 0
