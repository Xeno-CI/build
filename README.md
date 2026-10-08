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

Node가 있으면 `npx github:xeno-ci/build build --script ./ci.sh`도 같습니다. `--no-wait`는 접수만 하고 빌드 ID를 출력합니다. 작업을 중단(Ctrl+C·SIGTERM)하면 빌드도 취소됩니다.

CI별 예시와 curl만 쓰는 방법: https://xenoci.com/docs/ci

## AI 에이전트 (MCP · Claude Code · Codex · Cursor · 오모)

AI가 API 키 하나로 맥 확인·주문(결제 링크는 사람에게)·빌드·실패 로그 분석·재빌드·연장까지 합니다. 사람은 결제 링크에서 동의·결제만 합니다.

```sh
claude mcp add xenoci --env XENOCI_API_KEY=... -- npx -y -p github:xeno-ci/build xenoci-mcp
codex mcp add xenoci --env XENOCI_API_KEY=... -- npx -y -p github:xeno-ci/build xenoci-mcp
```

```json
{ "mcpServers": { "xenoci": { "command": "npx", "args": ["-y", "-p", "github:xeno-ci/build", "xenoci-mcp"], "env": { "XENOCI_API_KEY": "..." } } } }
```

도구: catalog, quote, create_order, order_status, wait_order, release_order, list_macs, extend, join_waitlist, build, build_status, wait_build, build_log, cancel_build, list_errors, secrets, account.
CLI도 같습니다: `xenoci catalog | order | orders | wait | release | macs | extend | waitlist | secrets | errors | whoami`, 모든 명령 `--json`.
오류는 `{"error":{"code","message","retryable","next","request_id",...}}` 형식이고 `next`에 다음 요청이 들어 있습니다.

AI용 안내: https://xenoci.com/llms.txt · OpenAPI: https://xenoci.com/openapi.json · 오류 코드: https://xenoci.com/docs/errors

환경 변수: `XENOCI_API_KEY`(필수), `XENOCI_API_URL`(기본 https://xenoci.com).
