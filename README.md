# XenoCI

빌린 Mac mini M4에서 API 키 하나로 빌드합니다. 이 저장소에는 GitHub Action, CLI, MCP 서버 실행 파일이 들어 있습니다.

API 키: https://app.xenoci.com/account/api-keys

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

## CLI

```sh
export XENOCI_API_KEY=...
npx github:xeno-ci/build build --script ./ci.sh --wait
npx github:xeno-ci/build --help
```

## MCP (Claude Code · Cursor)

```sh
claude mcp add xenoci --env XENOCI_API_KEY=... -- npx -y -p github:xeno-ci/build xenoci-mcp
```

```json
{ "mcpServers": { "xenoci": { "command": "npx", "args": ["-y", "-p", "github:xeno-ci/build", "xenoci-mcp"], "env": { "XENOCI_API_KEY": "..." } } } }
```

환경 변수: `XENOCI_API_KEY`(필수), `XENOCI_API_URL`(기본 https://app.xenoci.com).
