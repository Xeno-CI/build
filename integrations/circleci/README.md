# XenoCast for CircleCI (add-on)

Copy `.circleci/config.yml` and `run.sh` to your repository. The workflow installs `xenocast`; the script uploads the checkout and runs `XENO_BUILD_SCRIPT` (default `bash ci.sh`) on a XenoCI macOS VM

Put an API key (`xci_live_…`) issued in the XenoCI console in the CircleCI secret `XENOCI_API_KEY`. Never print or commit the value. Optional `XENO_API_BASE_URL` is normalized to the API origin; `XENOCI_API_URL` takes priority

The CLI sends the key as `Authorization: Bearer` to `/api/runner/v1`, filters credential files, streams redacted logs, cancels on job interruption and exits with the remote job result

Setup: https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md
