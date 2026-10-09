# XenoCI

빌린 Mac mini M4에서 API 키 하나로 빌드합니다. 이 저장소에는 GitHub Action, CLI, MCP 서버 실행 파일이 들어 있습니다.

API 키: https://xenoci.com/app/api-keys

## GitHub Actions

```yaml
name: macOS build
on: [push, workflow_dispatch]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: xeno-ci/build@v1
        with:
          api-key: ${{ secrets.XENOCI_API_KEY }}
          script: ./ci.sh
```

`pull_request` 이벤트면 PR 번호와 PR head 커밋(GitHub의 임시 merge 커밋이 아니라 PR 브랜치의 실제 커밋)을 빌드에 기록하고 그 커밋을 빌드합니다. `GET /api/ci/v1/builds?pr=번호`로 PR별 빌드를 찾을 수 있습니다.

### 취소 · merge queue · 스택 PR

GitHub에서 잡을 취소하면(취소 버튼, `concurrency`의 `cancel-in-progress`) Action이 Mac의 빌드도 바로 취소합니다. 같은 PR에 새 커밋이 올라오거나 스택을 rebase할 때 이전 커밋의 빌드가 Mac을 붙잡지 않게 하려면:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

merge queue를 쓰면 트리거에 `merge_group:`을 추가하세요. Action은 merge queue가 만든 커밋을 빌드하고, 큐 브랜치(`gh-readonly-queue/<base>/pr-<번호>-<sha>`)에서 PR 번호를 읽어 기록합니다. 필수 체크는 job 이름이므로 `pull_request`와 `merge_group`에서 같은 job을 쓰면 됩니다.

```yaml
on:
  pull_request:
  merge_group:
    types: [checks_requested]
```

GitHub 스택 PR은 층마다 워크플로가 돕니다. 맨 위 층이 스택의 모든 변경을 담으므로, Mac 빌드는 맨 위 층과 merge queue에서만 돌리면 빌드 수가 줄어듭니다: `if: github.event_name == 'merge_group' || github.event.pull_request.stack == null || github.event.pull_request.stack.position == github.event.pull_request.stack.size`. 먼저 머지할 빌드는 `priority: high`로 내 계정 대기열 맨 앞에 둘 수 있습니다.

같은 저장소의 빌드는 브랜치·PR이 달라도 Mac 안의 같은 작업 폴더와 Xcode DerivedData를 이어 쓰고, 그 저장소를 마지막에 빌드한 Mac이 먼저 배정됩니다. 스택의 위아래 층처럼 차이가 작은 커밋은 바뀐 파일만 다시 컴파일합니다. 처음부터 빌드하려면 CLI `--clean`.

## CLI (Jenkins · GitLab · Bitbucket · CircleCI · Buildkite · 셸 · git 없는 폴더)

Node 없이 쓰는 실행 파일 하나입니다. 설치 스크립트가 SHA256SUMS로 체크섬을 확인합니다.

```sh
curl -fsSL https://github.com/Xeno-CI/build/releases/latest/download/install.sh | sh
export XENOCI_API_KEY=...
xenoci build --script ./ci.sh      # 현재 폴더 업로드 → 빌드 → 로그 → 빌드 종료 코드로 끝남
```

Windows (PowerShell):

```powershell
irm https://github.com/Xeno-CI/build/releases/latest/download/install.ps1 | iex
```

`--pr`·`--commit`을 주지 않으면 CI 변수(GitHub Actions·Jenkins·GitLab·Buildkite·CircleCI·Bitrise·Azure)와 `git rev-parse HEAD`로 PR 번호와 커밋을 자동으로 붙입니다. `--dir`와 `--repo owner/name`을 같이 주면 폴더를 올리고 저장소 이름은 표시·검색용으로만 씁니다.

Node가 있으면 `npx github:xeno-ci/build build --script ./ci.sh`도 같습니다. `--no-wait`는 접수만 하고 빌드 ID를 출력합니다. 작업을 중단(Ctrl+C·SIGTERM)하면 빌드도 취소됩니다.

CLI를 설치하지 않고 쓰는 CI별 예제(파일을 저장소에 그대로 복사, `bash`·`curl`만 필요)는 이 저장소의 [`integrations/`](integrations)에 있습니다:
[Jenkins](integrations/jenkins) · [GitLab Runner custom executor](integrations/gitlab-executor) · [Buildkite 플러그인](integrations/buildkite-plugin) · [CircleCI](integrations/circleci) · [Bitrise](integrations/bitrise) · [Azure Pipelines](integrations/azure) · [로컬·git hook (sh, PowerShell)](integrations/local)

curl만 쓰는 방법(REST 예시)과 오류 코드: https://xenoci.com/agent-start.md · https://xenoci.com/docs/errors

## AI 에이전트 (MCP · Claude Code · Codex · Cursor · 오모)

설정 파일 예시(Claude Code `.mcp.json`, Codex `config.toml`, Cursor `mcp.json`)와 연결 확인, 첫 요청까지: [mcp/CONNECT.md](mcp/CONNECT.md)

AI가 API 키 하나로 맥 확인·주문(결제 링크는 사람에게)·빌드·실패 로그 분석·재빌드·연장까지 합니다. 사람은 결제 링크에서 동의·결제만 합니다.

```sh
claude mcp add xenoci --env XENOCI_API_KEY=... -- npx -y -p github:xeno-ci/build xenoci-mcp
codex mcp add xenoci --env XENOCI_API_KEY=... -- npx -y -p github:xeno-ci/build xenoci-mcp
```

```json
{ "mcpServers": { "xenoci": { "command": "npx", "args": ["-y", "-p", "github:xeno-ci/build", "xenoci-mcp"], "env": { "XENOCI_API_KEY": "..." } } } }
```

도구: catalog, quote, create_order, order_status, wait_order, list_macs, extend, reset_macs, set_xcode, update_mac, job_status, join_waitlist, build, build_artifacts, build_status, wait_build, build_log, cancel_build, list_errors, secrets, account.
CLI도 같습니다: `xenoci catalog | order | orders | wait | macs | extend | xcode | reset | setup | job | waitlist | secrets | build | status | logs | artifacts | cancel | errors | whoami | ios`, 모든 명령 `--json`. 견적·주문의 `--start`(MCP `start`)로 미래 시작 시각의 재고와 금액을 봅니다. 빌드 결과물(ipa·xcarchive·xcresult)은 `xenoci build --artifacts 'build/*.ipa'`로 남기고 `xenoci artifacts <id> --out ./dist`(MCP `build_artifacts`)로 받습니다(7일 보관).
오류는 `{"error":{"code","message","retryable","next","request_id",...}}` 형식이고 `next`에 다음 요청이 들어 있습니다.

AI용 안내(llms.txt): https://gist.github.com/001005HS/d6a483152886b14e07bda46e90da304d · OpenAPI: https://xenoci.com/openapi.json · 오류 코드: https://xenoci.com/docs/errors

환경 변수: `XENOCI_API_KEY`(필수), `XENOCI_API_URL`(기본 https://xenoci.com).
