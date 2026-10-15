# xenoci MCP 연결 (Claude Code, Codex CLI, Cursor)

XenoCast CLI(`xenocast`)를 설치하고 콘솔에서 발급한 API 키를 넣은 뒤 MCP를 연결합니다. 잡 도구의 인증은 API 키(`xci_live_…`)입니다, 조직 관리 도구만 따로 관리자 키(`xci_admin_…`)를 씁니다. MCP 설정 파일에는 키를 넣지 않습니다. MCP 서버는 `XENOCI_API_KEY` 또는 이 컴퓨터에 저장된 키(OS 키체인 또는 암호화 파일)를 씁니다. 옛 이름 `xenoci`도 같은 명령으로 동작하고, 이미 `xenoci`로 등록한 MCP 설정은 그대로 씁니다

## 0. AI에게 맡기기 (권장, Node 필요 없음)

AI 에이전트에 https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md 를 보내면 에이전트가 아래를 실행합니다. 사람이 할 일은 콘솔에서 크레딧 충전과 키 발급, 키를 비밀 저장소에 `XENOCI_API_KEY` 이름으로 넣는 것입니다. 에이전트가 비밀 저장소에서 키를 받아 아래를 실행합니다

```sh
curl -fsSL https://github.com/Xeno-CI/xenocast/releases/latest/download/install.sh | XENOCAST_NO_SETUP=1 sh
export PATH="$HOME/.local/bin:$PATH"   # install.sh 는 ~/.local/bin 에 설치하고 PATH 는 바꾸지 않음
# Windows PowerShell: irm https://github.com/Xeno-CI/xenocast/releases/latest/download/install.ps1 | iex
export XENOCI_API_KEY="$(security find-generic-password -a "$USER" -s XENOCI_API_KEY -w)"   # 비밀 저장소에서 키 꺼내기(macOS 예)
xenocast setup --no-tui --key-env XENOCI_API_KEY   # 키 확인 + 키 저장 + 설치된 AI 앱에 xenoci 등록 + MCP 서버 확인
unset XENOCI_API_KEY
```

`setup`은 고른 앱의 설정에 `xenoci` 항목 하나만 넣습니다(다른 항목은 그대로, 기존 파일은 백업). 넣는 명령은 `xenocast mcp`이고 `env`는 비어 있습니다

| 앱 | 파일 |
|---|---|
| Claude Code | `~/.claude.json`의 `mcpServers.xenoci` |
| Codex CLI | `~/.codex/config.toml`(`CODEX_HOME`)의 `[mcp_servers.xenoci]` |
| Cursor | `~/.cursor/mcp.json`의 `mcpServers.xenoci` |
| Claude 데스크톱 | `claude_desktop_config.json`(macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`, Linux `~/.config/Claude/`)의 `mcpServers.xenoci` |
| OpenCode | `~/.config/opencode/opencode.json`(`XDG_CONFIG_HOME`)의 `mcp.xenoci` |
| OmO | `~/.omo/agent/mcp.json`(`OMO_CODING_AGENT_DIR`)의 `mcpServers.xenoci` |

키
- `xenocast setup --key-env XENOCI_API_KEY`: 환경 변수의 키를 확인한 뒤 저장합니다. 키만 저장하려면 `xenocast config set api-key --key-env XENOCI_API_KEY`. 키는 명령 인자로 받지 않습니다
- 저장 위치: macOS 키체인, Windows 자격 증명 관리자, Linux secret-service, 셋 다 없으면 이 기기에 묶인 AES-256-GCM 암호화 파일. `XENOCAST_CREDENTIAL_STORE`로 고를 수 있습니다
- `XENOCI_API_KEY` 환경 변수가 있으면 저장된 키보다 우선합니다. CI에서는 비밀 변수 `XENOCI_API_KEY`를 씁니다
- `xenocast config show`는 키 출처와 가린 값을, `xenocast config unset api-key`는 저장된 키 삭제를 합니다

## 1. 직접 설정 (Node와 npx)

먼저 한 번 `xenocast config set api-key --key-env XENOCI_API_KEY`로 비밀 저장소의 키를 이 컴퓨터에 저장합니다. 그다음 하나만 고릅니다

### Claude Code

```sh
claude mcp add xenoci --scope user -- npx -y -p github:xeno-ci/xenocast xenoci-mcp
```

또는 저장소에 두는 `.mcp.json`: [`examples/claude-code.mcp.json`](examples/claude-code.mcp.json)

```json
{
  "mcpServers": {
    "xenoci": {
      "command": "npx",
      "args": ["-y", "-p", "github:xeno-ci/xenocast", "xenoci-mcp"],
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
args = ["-y", "-p", "github:xeno-ci/xenocast", "xenoci-mcp"]
startup_timeout_sec = 60
tool_timeout_sec = 600
```

### Cursor

`.cursor/mcp.json`(저장소) 또는 `~/.cursor/mcp.json`: [`examples/cursor.mcp.json`](examples/cursor.mcp.json)

```json
{
  "mcpServers": {
    "xenoci": {
      "command": "npx",
      "args": ["-y", "-p", "github:xeno-ci/xenocast", "xenoci-mcp"]
    }
  }
}
```

## 2. 연결 확인

공개 MCP 도구는 11개입니다: `build`, `status`, `cancel`, `logs`, `list_runners`, `whoami`, `credits`, `usage`, `failure`, `compare`, `search_log`. xenocast 1.7.0 이상 기준이고, 그보다 옛 버전은 `failure`, `compare`, `search_log`가 없는 8개라 설치 줄을 다시 실행해 업데이트합니다([업데이트 방법](https://xenoci.com/docs/resources/clients#설치와-로그인)), 지금 버전은 `xenocast --version`. 키가 없어도 도구 목록은 같습니다. 목록에 없는 이름은 JSON-RPC `-32602`입니다

에이전트에게 "xenoci whoami 도구를 불러 줘"라고 합니다. 키의 조직과 워크스페이스가 보이면 됩니다. 오류가 나면 `error.code`를 봅니다

| code | 뜻 | 할 일 |
|---|---|---|
| `api_key_required` | 키가 없음 | 비밀 저장소의 키로 `xenocast setup --no-tui --key-env XENOCI_API_KEY` 후 에이전트를 다시 시작 |
| `invalid_api_key` | 키가 폐기됐거나 만료됨 | 콘솔에서 새 키를 발급해 비밀 저장소 값을 바꾸고 `xenocast setup --no-tui --key-env XENOCI_API_KEY` |
| `insufficient_credit` | 잔액 부족 | `error.topup_url`을 사람에게 보여 줌(충전은 사람이 콘솔에서) |

## 3. 첫 요청

> 이 폴더의 Swift 앱을 XenoCI에서 빌드해서 결과물을 ./dist에 받아 줘

1. `list_runners`: 쓸 수 있는 러너와 분당 단가
2. `build`: `dir`에 프로젝트 폴더의 절대 경로, `script`에 빌드 명령, `artifacts: ["build/App.xcarchive"]`. 잡 ID가 바로 돌아옵니다
3. `status`(`id`): 상태, 금액, 마지막 로그 줄
4. `logs`(`id`, `out: "./dist"`, `artifacts: true`): 전체 로그와 결과물을 파일로 저장(`artifacts`를 빼면 로그만 저장)
5. 멈추려면 `cancel`(`id`)

전체 문서: https://xenoci.com/docs/agents/xenocast#ai-앱에서-쓸-때, CLI로 같은 일을 하려면 `xenocast --help`
