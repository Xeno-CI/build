# XenoCI GitLab custom executor (부가 기능 / add-on)

GitLab job의 스크립트를 XenoCI macOS VM에서 실행하는 [custom executor](https://docs.gitlab.com/runner/executors/custom.html)입니다. 콘솔에서 발급한 API 키 `XENOCI_API_KEY` 하나면 됩니다(SSH, VM 생성 없음)
A GitLab Runner custom executor that runs the job on a XenoCI macOS VM with one API key from the XenoCI console, no SSH, no VM to create

## 동작 / How it works

- GitLab Runner 자체 단계(`get_sources`, cache, artifacts)는 러너 호스트에서 그대로 실행됩니다(shell executor와 같음)
- 작업 스크립트 단계에서 CLI `xenocast build`가 프로젝트 폴더를 업로드하고 로그와 종료 결과를 전달합니다. CLI가 키를 `Authorization: Bearer`로 `/api/runner/v1`에 보내고 자격 파일을 제외합니다
- VM에서 실행되는 것은 `XENOCI_BUILD_SCRIPT`(기본 `bash ci.sh`)입니다. `.gitlab-ci.yml`의 `script:` 줄은 VM으로 가지 않습니다(GitLab이 만드는 스크립트에는 러너 전용 경로와 job token이 들어 있기 때문). job 변수 `XENOCI_BUILD_SCRIPT`로 job마다 바꿀 수 있습니다
- 빌드 실패는 GitLab 빌드 실패(`BUILD_FAILURE_EXIT_CODE`), API, 네트워크 오류는 시스템 실패로 끝납니다. job을 취소하면(SIGTERM) 원격 잡도 취소합니다

## 설치 / Install

필요: `bash`, `jq`, PATH에 설치된 `xenocast`. 이 폴더를 러너 호스트(예: `/opt/xenoci/gitlab-executor`)에 복사합니다

```toml
[[runners]]
  name = "xenoci-mac"
  url = "https://gitlab.com"
  token = "…"
  executor = "custom"
  environment = ["XENOCI_API_KEY=xci_live_…"]   # or export it in the runner service environment
  [runners.custom]
    config_exec = "/opt/xenoci/gitlab-executor/config.sh"
    prepare_exec = "/opt/xenoci/gitlab-executor/prepare.sh"
    run_exec = "/opt/xenoci/gitlab-executor/run.sh"
    cleanup_exec = "/opt/xenoci/gitlab-executor/cleanup.sh"
```

`.gitlab-ci.yml`:

```yaml
mac-build:
  tags: [xenoci-mac]
  variables:
    XENOCI_BUILD_SCRIPT: "bash ci.sh"     # runs on the VM, in the project folder
  script:
    - echo "built on XenoCI"               # runs nowhere: the VM runs XENOCI_BUILD_SCRIPT
```

API 키는 러너 설정(`environment`)에 두세요. job 변수로 넣지 않습니다(VM으로 가는 것은 업로드한 폴더와 스크립트뿐)
선택 환경 변수: `XENOCI_API_URL`(기본 `https://xenoci.com`), `XENOCI_XCODE`, `XENOCI_TIMEOUT_MIN`

러너 설치 없이 기존 러너에서 바로 쓰려면 `xenocast build --script ./ci.sh`를 실행합니다. 설치: https://github.com/Xeno-CI/xenocast

## 파일 / Files

- `config.sh` `prepare.sh`(키 확인) `run.sh` `cleanup.sh`(잡이 끝나면 VM은 지워짐)

