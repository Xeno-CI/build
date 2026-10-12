# Local builds

Set up XenoCast with your API key first (https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md, `xenocast setup` saves the key on this computer). `xenoci-build.sh` and `xenoci-build.ps1` call `xenocast build` on the current repository folder. Tracked and untracked files follow `.gitignore`; `.git`, credential files and device keys are always excluded. The CLI streams redacted logs, cancels on interruption and returns the job exit code

```sh
sh integrations/local/xenoci-build.sh
```

```powershell
pwsh -File integrations/local/xenoci-build.ps1
```

Optional: `XENOCI_BUILD_SCRIPT` (default `bash ci.sh`), `XENOCI_API_URL` (default `https://xenoci.com`). Uncommitted changes are included. In noninteractive CI use the secret environment variable `XENOCI_API_KEY`; it takes priority over the saved key

The included Makefile and pre-push examples call this adapter. A pre-push build represents the current checkout; use it only when that is the intended push target

Setup: https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md
