# Jenkins (add-on)

Install `xenocast` on the Jenkins agent and put it on PATH:

```sh
curl -fsSL https://github.com/Xeno-CI/xenocast/releases/latest/download/install.sh | XENOCAST_NO_SETUP=1 sh
```

Store an API key (`xci_live_…`) issued in the XenoCI console as a Secret text credential with ID `XENOCI_API_KEY` and use the included `Jenkinsfile`. Do not expose credentials to fork PR jobs

`xenoci-build.sh` executes `xenocast build --dir <checkout> --script <XENOCI_BUILD_SCRIPT>`. The CLI sends the key as `Authorization: Bearer` to `/api/runner/v1`, uploads the folder with credential exclusions, streams redacted logs, cancels on SIGTERM/SIGINT and returns the job exit code. `XENOCI_BUILD_SCRIPT` defaults to `bash ci.sh`; `XENOCI_API_URL` defaults to `https://xenoci.com`

Setup: https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md
