# XenoCast for Bitrise (add-on)

Place the workflow in `bitrise.yml` after Git Clone. It installs `xenocast`; `run.sh` uploads the checkout and runs `XENO_BUILD_SCRIPT` (default `bash ci.sh`) on a XenoCI macOS VM, streams redacted logs and returns the job exit code

Put an API key (`xci_live_…`) issued in the XenoCI console in the Bitrise secret `XENOCI_API_KEY`. Never put the key in YAML or chat. Optional `XENO_API_BASE_URL` is normalized to the API origin; `XENOCI_API_URL` takes priority

The CLI sends the key as `Authorization: Bearer` to `/api/runner/v1`, filters credential files from uploads and cancels the remote job when stopped

Setup: https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md
