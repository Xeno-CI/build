# XenoCI Buildkite plugin (부가 기능 / add-on)

Buildkite step의 `command`를 에이전트 대신 XenoCI macOS VM에서 실행합니다. 에이전트가 체크아웃한 폴더를 올리고, 로그를 Buildkite로 그대로 보여 주며, 잡 종료 코드로 끝납니다. 콘솔에서 발급한 API 키 하나면 됩니다(SSH, VM 생성 없음)
Runs the step's command on a XenoCI macOS VM instead of the agent: the checkout is uploaded, the log streams into Buildkite, and the step ends with the job's exit code. One API key from the XenoCI console; no SSH, no VM to create

## Pipeline

```yaml
steps:
  - label: ":apple: macOS build"
    command: bash ci.sh
    plugins:
      - ./integrations/buildkite-plugin:   # this folder, committed to your repository
          xcode: "26.6"                    # optional
          timeout-min: 60                  # optional
```

에이전트 환경(예: `/etc/buildkite-agent/hooks/environment` 또는 시크릿 도구)에 `XENOCI_API_KEY`를 둡니다. 파이프라인 YAML에 넣지 마세요
Put `XENOCI_API_KEY` in the agent environment (hooks/environment or your secrets tool), never in pipeline YAML

필요 / Requirements: `bash`, `jq`, `xenocast` on PATH. Install from https://github.com/Xeno-CI/xenocast

## API calls

The adapter calls `xenocast build` with the checkout and command. The CLI sends `XENOCI_API_KEY` as `Authorization: Bearer` to `/api/runner/v1`, filters credentials from uploads and streams redacted logs. A cancelled job (SIGTERM/SIGINT) cancels the remote job

