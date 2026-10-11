# XenoCI Buildkite plugin

Buildkite step의 `command`를 에이전트 대신 빌린 XenoCI 맥에서 실행합니다. 에이전트가 체크아웃한 폴더를 올리고, 로그를 Buildkite로 그대로 보여 주며, 빌드 종료 코드로 끝납니다. CI 토큰 하나면 됩니다(SSH, VM 생성 없음).
Runs the step's command on your rented XenoCI Mac instead of the agent: the checkout is uploaded, the log streams into Buildkite, and the step ends with the build's exit code. One CI token; no SSH, no VM to create.

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

에이전트 환경(예: `/etc/buildkite-agent/hooks/environment` 또는 시크릿 도구)에 `XENOCAST_TOKEN`(`xenocast token --ci`, 빌드 전용)을 둡니다. 파이프라인 YAML에 넣지 마세요. 예전 `XENOCI_API_KEY`는 종료되었습니다.
Put `XENOCAST_TOKEN` (`xenocast token --ci`, build only) in the agent environment (hooks/environment or your secrets tool), never in pipeline YAML.

필요 / Requirements: `bash`, `curl`, `jq`, `tar`, `gzip` on the agent.

## API calls

1. `POST /api/ci/v1/uploads/tar?project=<BUILDKITE_PIPELINE_SLUG>` — the checkout (`BUILDKITE_BUILD_CHECKOUT_PATH`, without `.git`) as gzip tar; file modes are kept, so `./ci.sh` stays executable.
2. `POST /api/ci/v1/builds` — `{"script":"<BUILDKITE_COMMAND>","upload_id":"up_…","commit":"<BUILDKITE_COMMIT>","pr":<BUILDKITE_PULL_REQUEST>}` (`pr` only when it is a number).
3. `GET /api/ci/v1/builds/<id>/log?format=text&offset=<n>&wait=20` until `X-Build-State` is terminal. A cancelled job (SIGTERM) cancels the remote build.

