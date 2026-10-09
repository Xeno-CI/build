# xenoci-mcp 5분 연결 (Claude Code · Codex CLI · Cursor)

필요한 것: Node 18 이상, API 키 하나. 키는 https://xenoci.com/app/api-keys 에서 만듭니다. 맥 주문과 빌드를 둘 다 시키려면 권한에 `build`와 `order`를 넣으세요(기본 키는 read·build·order). 키는 파일에 직접 쓰지 말고 환경 변수 `XENOCI_API_KEY`로 넘깁니다.

```sh
export XENOCI_API_KEY=xeno_ci_...     # Windows PowerShell: $env:XENOCI_API_KEY = "xeno_ci_..."
```

에이전트를 시작하는 셸에 이 변수가 있어야 합니다. 키를 바꾸거나 나중에 설정했다면 에이전트(또는 MCP 서버)를 다시 시작하세요.

## 1. 설정 (하나만)

### Claude Code

명령 한 줄(사용자 범위):

```sh
claude mcp add xenoci --scope user --env XENOCI_API_KEY=$XENOCI_API_KEY -- npx -y -p github:xeno-ci/build xenoci-mcp
```

또는 저장소에 두는 `.mcp.json`(값은 각자 셸의 `XENOCI_API_KEY`에서 펼쳐짐, 키가 저장소에 들어가지 않음): [`examples/claude-code.mcp.json`](examples/claude-code.mcp.json)

```json
{
  "mcpServers": {
    "xenoci": {
      "command": "npx",
      "args": ["-y", "-p", "github:xeno-ci/build", "xenoci-mcp"],
      "env": { "XENOCI_API_KEY": "${XENOCI_API_KEY}" },
      "timeout": 600000
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`(또는 저장소의 `.codex/config.toml`): [`examples/codex-config.toml`](examples/codex-config.toml)

```toml
[mcp_servers.xenoci]
command = "npx"
args = ["-y", "-p", "github:xeno-ci/build", "xenoci-mcp"]
env_vars = ["XENOCI_API_KEY"]   # Codex 셸의 값을 그대로 넘김(파일에 키를 쓰지 않음)
startup_timeout_sec = 60        # 첫 npx 내려받기
tool_timeout_sec = 600          # build가 끝날 때까지 기다림
```

### Cursor

`.cursor/mcp.json`(저장소) 또는 `~/.cursor/mcp.json`: [`examples/cursor.mcp.json`](examples/cursor.mcp.json)

```json
{
  "mcpServers": {
    "xenoci": {
      "command": "npx",
      "args": ["-y", "-p", "github:xeno-ci/build", "xenoci-mcp"],
      "env": { "XENOCI_API_KEY": "${env:XENOCI_API_KEY}" }
    }
  }
}
```

## 2. 연결 확인

에이전트에게 "xenoci account 도구를 불러 줘"라고 합니다. `key.can`에 `build`·`order`가 보이면 됩니다. 오류가 나면 `error.code`를 봅니다.

| code | 뜻 | 할 일 |
|---|---|---|
| `api_key_required` | MCP 서버가 `XENOCI_API_KEY`를 못 받음 | 위 `export`를 한 셸에서 에이전트를 다시 시작. Codex는 `env_vars`, Cursor는 `${env:...}` 표기 확인 |
| `invalid_api_key` | 키가 틀렸거나 지워짐·만료 | 새 키를 만들어 교체(재시도해도 같음) |
| `insufficient_scope` | 키에 그 권한이 없음(`required_scope`, `key_can`) | 그 권한을 넣은 키를 새로 만듦 |

## 3. 첫 요청

> 이 폴더의 Swift 앱을 XenoCI에서 빌드해서 결과물을 ./dist에 받아 줘.

에이전트는 처음 받는 MCP 안내만 보고 다음 순서로 진행합니다(사람이 할 일은 결제 링크를 열어 결제하는 것 하나).

1. `list_macs` — 이미 빌린 맥이 있으면 4로.
2. `catalog` → `quote` → `create_order` — 결제 링크(`pay_url`)를 사람에게 보여 줌. 도구는 결제할 수 없음.
3. `wait_order` — `ready`가 될 때까지 다시 부름.
4. `build` — `dir`에 프로젝트 폴더의 절대 경로, `script`에 예: `xcodebuild -scheme App -destination generic/platform=iOS -archivePath build/App.xcarchive archive CODE_SIGNING_ALLOWED=NO`, `artifacts: ["build/App.xcarchive"]`(폴더는 zip으로 돌아옴). 서명용 인증서·프로파일을 `secrets`로 넣어 두었다면 `-exportArchive`로 .ipa를 만들고 `artifacts: ["build/*.ipa"]`.
5. 실패하면 `build_log`(`mode: "failure"`) → 고쳐서 다시 `build`.
6. `build_artifacts` — 도구는 링크만 돌려줌. 에이전트가 각 `download_url`(15분 유효, 키 필요 없음)을 `curl -fLo dist/<name> "<download_url>"`로 받아 `sha256`을 비교.

맥은 `ends_at`에 저절로 끝나고 VM이 지워집니다(반납 기능은 없음). 결과물은 그 전에 받으세요.

자주 나는 오류와 다음 행동:

| code | 다음 행동 |
|---|---|
| `no_active_rental` | 맥이 없음 → 2번(주문) 또는 `build`에 `queue_until_rental: true` |
| `no_capacity` | 재고 없음 → `quote`의 `earliest_start_at`을 `start`로 주문하거나 `join_waitlist` |
| `xcode_not_available` | 그 Xcode 없음 → `options` 중 하나로 다시 |
| `xcode_not_on_any_mac` | 내 맥에 그 Xcode 없음 → `set_xcode` 후 다시 `build` |

전체 오류 코드: https://xenoci.com/docs/errors · CLI로 같은 일을 하려면 `xenoci --help`.
