# XenoCI

빌린 Mac mini M4에서 API 키 하나로 빌드합니다. 이 저장소에는 GitHub Action, XenoCast CLI(`xenocast`), MCP 서버 실행 파일이 들어 있습니다. 옛 이름 `xenoci`도 같은 명령으로 동작합니다(설치 스크립트가 `xenoci` 링크도 만듭니다).

API 키: https://xenoci.com/app/api-keys

## GitHub Actions

```yaml
name: macOS build
on: [push, workflow_dispatch]
jobs:
  build:
    # 자체 러너가 있으면 [self-hosted]로 바꾸세요
    # GitHub 호스팅 러너(ubuntu-latest 등)를 쓰면 GitHub Actions 요금이 나올 수 있습니다
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
xenocast build --script ./ci.sh      # 현재 폴더 업로드 → 빌드 → 로그 → 빌드 종료 코드로 끝남
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

Node 없이 CLI로 연결(키가 대화·설정 파일에 남지 않음): 콘솔에서 키를 복사한 뒤

```sh
xenocast init --from-clipboard --client codex   # claude | cursor | all: 키 확인·저장 + 그 앱의 MCP 설정(xenocast mcp)
xenocast doctor                                  # 연결·권한·빌린 맥·MCP 점검
```

```sh
claude mcp add xenoci --env XENOCI_API_KEY=... -- npx -y -p github:xeno-ci/build xenoci-mcp
codex mcp add xenoci --env XENOCI_API_KEY=... -- npx -y -p github:xeno-ci/build xenoci-mcp
```

```json
{ "mcpServers": { "xenoci": { "command": "npx", "args": ["-y", "-p", "github:xeno-ci/build", "xenoci-mcp"], "env": { "XENOCI_API_KEY": "..." } } } }
```

공개 MCP 도구 12개: account, plan, mac, build, status, logs, diagnose, signing, ship, sim, secrets, webhooks. 기존 개별 이름은 숨겨진 호환 별칭입니다. `action: "describe", for_action: "<action>"`으로 정확한 스키마를 읽고 action을 선택합니다. iOS 인수는 `input` 안에 넣으며, `build` action `submit`의 `script`·`dir`·`repo` 등은 최상위에 둡니다.
CLI는 기존 명령 체계를 유지합니다: `xenocast init | doctor | mcp | catalog | order | orders | wait | macs | extend | xcode | reset | setup | job | waitlist | secrets | build | status | logs | artifacts | cancel | errors | whoami | webhooks | watch | ios`, 모든 명령 `--json`. 견적·주문의 `--start`(MCP `start`)로 미래 시작 시각의 재고와 금액을 봅니다. 빌드 결과물(ipa·xcarchive·xcresult)은 `xenocast build --artifacts 'build/*.ipa'`로 남기고 `xenocast artifacts <id> --out ./dist`(MCP `logs` action `artifacts`)로 받습니다(7일 보관).
오류는 `{"error":{"code","message","retryable","next","request_id",...}}` 형식이고 `next`에 다음 요청이 들어 있습니다.

AI용 안내(llms.txt): https://gist.github.com/001005HS/d6a483152886b14e07bda46e90da304d · OpenAPI: https://xenoci.com/openapi.json · 오류 코드: https://xenoci.com/docs/errors

환경 변수: `XENOCI_API_KEY`(xenocast init으로 저장했으면 생략 가능, 환경 변수가 우선; 콘솔의 `xeno_ci_` 프로젝트 키로 CI와 iOS 공용), `XENOCI_API_URL`(기본 https://xenoci.com), `XENOCI_CONFIG_DIR`(저장 위치). 기존 `xeno_ak_`는 iOS 호환 엔드포인트 전용입니다. iOS 권한 매핑: `read=R`, `build=W/S+createApps`, `secrets=V`, `manage=V/G/A/D`.

CLI 진단은 `xenocast diagnose <rb_id>`, 사전 점검은 `xenocast preflight --input preflight.json`입니다. 관리형 iOS는 `xenocast ios archive|sign|ship --app ID --input action.json --idempotency-key KEY`로 각각 archive, 서명 export, TestFlight 업로드를 요청합니다. 접수와 실제 업로드 성공은 다르므로 종료 상태와 Apple 결과를 확인하세요. 상세: https://xenoci.com/ios-guide.md
