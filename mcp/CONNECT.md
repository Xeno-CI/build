# xenoci MCP 연결 (Claude Code, Codex CLI, Cursor)

XenoCast CLI(`xenocast`)로 설치하고 GitHub으로 로그인한 뒤 MCP를 연결합니다. MCP 설정 파일에는 키나 토큰을 넣지 않습니다. MCP 서버는 이 컴퓨터에 저장된 로그인(OS 키체인 또는 암호화 파일)을 씁니다. 옛 이름 `xenoci`도 같은 명령으로 동작하고, 이미 `xenoci`로 등록한 MCP 설정은 그대로 씁니다.

## 0. AI에게 맡기기 (권장, Node 필요 없음)

AI 에이전트에 https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md 를 보내면 에이전트가 아래를 실행합니다. 사람이 할 일은 로그인 링크를 열어 GitHub으로 승인하는 것 하나입니다.

```sh
curl -fsSL https://github.com/Xeno-CI/xenocast/releases/latest/download/install.sh | sh
# Windows PowerShell: irm https://github.com/Xeno-CI/xenocast/releases/latest/download/install.ps1 | iex
xenocast login                 # 링크를 열고 GitHub으로 로그인, 화면의 코드를 확인하고 승인
xenocast setup --no-tui        # 설치된 AI 앱에 xenoci 등록 + doctor + 연결 확인 빌드
xenocast doctor                # 로그인, 연결, 권한, 빌린 Mac, MCP 서버, 앱 설정 (문제면 종료 코드 1)
```

`setup`은 고른 앱의 설정에 `xenoci` 항목 하나만 넣습니다(다른 항목은 그대로, 기존 파일은 백업). 넣는 명령은 `xenocast mcp`이고 `env`는 비어 있습니다.

| 앱 | 파일 |
|---|---|
| Claude Code | `~/.claude.json`의 `mcpServers.xenoci` |
| Codex CLI | `~/.codex/config.toml`(`CODEX_HOME`)의 `[mcp_servers.xenoci]` |
| Cursor | `~/.cursor/mcp.json`의 `mcpServers.xenoci` |

로그인
- `xenocast login`: 터미널에 나온 링크(https://xenoci.com/app/device?code=...)를 열어 GitHub으로 로그인하고, 화면의 코드가 터미널과 같은지 확인한 뒤 승인합니다. 링크는 10분 뒤 만료됩니다. 에이전트가 백그라운드로 돌릴 때는 `xenocast login --json`의 stderr 첫 줄 `{"event":"device_code",...}`에서 링크를 읽습니다
- 저장 위치: macOS 키체인, Windows 자격 증명 관리자, Linux secret-service, 셋 다 없으면 이 기기에 묶인 AES-256-GCM 암호화 파일(`~/.config/xenoci/credentials.enc`). `XENOCAST_CREDENTIAL_STORE`로 고를 수 있습니다
- 로그인은 약 1시간짜리 접근 토큰과 갱신 토큰입니다. CLI와 MCP 서버가 만료 전에 알아서 갱신합니다(여러 프로세스가 동시에 갱신해도 한 번만)
- `xenocast logout`은 서버에서 세션을 폐기하고 이 컴퓨터에서 지웁니다. `xenocast whoami`는 계정(이메일 일부), 프로젝트, 권한, 세션 만료를 보여 줍니다
- API 키(`xeno_ci_...`)는 종료되었습니다. 예전 키 파일은 처음 실행할 때 지워지고 `reauth_required`가 나오면 `xenocast login`을 한 번 하면 됩니다
- CI에서는 로그인 대신 CI 토큰 `XENOCAST_TOKEN`을 씁니다: `xenocast token --ci --raw | gh secret set XENOCAST_TOKEN --repo owner/name`. CI 토큰은 빌드 전용입니다(서명, 주문, 연장 불가). 자세한 CI 설정과 포크 PR 경고는 [SETUP.md의 CI 연결](../SETUP.md)

## 1. 직접 설정 (Node와 npx)

먼저 한 번 `xenocast login`(또는 `npx -y -p github:xeno-ci/xenocast xenocast login`)을 합니다. 그다음 하나만 고릅니다.

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

공개 MCP 도구는 5개입니다: `build`, `status`, `cancel`, `logs`, `macs`. 예전 도구 이름(`build_status`, `wait_build`, `list_macs` 등)은 숨겨진 호환 별칭으로 계속 답합니다. 주문, 연장, 서명, 시뮬레이터, 시크릿, 웹훅처럼 MCP에서 뺀 일은 그 CLI 명령을 알려 주는 `moved_to_cli` 오류로 답합니다(`xenocast --help`).

에이전트에게 "xenoci macs 도구를 불러 줘"라고 합니다. 로그인한 계정과 빌린 Mac이 보이면 됩니다. 오류가 나면 `error.code`를 봅니다.

| code | 뜻 | 할 일 |
|---|---|---|
| `login_required` | 이 컴퓨터에 로그인이 없음 | 터미널에서 `xenocast login` 후 에이전트를 다시 시작 |
| `reauth_required` | 로그인이 만료, 폐기됐거나 예전 API 키였음 | `xenocast login` |
| `insufficient_scope` | 그 권한이 없음(CI 토큰으로 주문 등) | 로그인한 계정으로 하거나 CLI에서 함 |
| `no_active_rental` | 빌린 Mac이 없음 | https://xenoci.com/app/store 에서 빌림(결제는 사람이) |

## 3. 첫 요청

> 이 폴더의 Swift 앱을 XenoCI에서 빌드해서 결과물을 ./dist에 받아 줘

1. `macs`: 빌린 Mac과 남은 시간. 없거나 6시간 이하면 `extend_hint`의 링크를 사람에게 보여 줍니다(결제는 사람이)
2. `build`: `dir`에 프로젝트 폴더의 절대 경로, `script`에 예: `xcodebuild -scheme App -destination generic/platform=iOS -archivePath build/App.xcarchive archive CODE_SIGNING_ALLOWED=NO`, `artifacts: ["build/App.xcarchive"]`. 빌드 ID가 바로 돌아옵니다. 이 결과는 서명 전 archive이며 IPA가 아닙니다
3. `status`(`id`, `wait: true`): 끝날 때까지 기다리고, 실패하면 실패 요약(분류, 첫 오류 file:line, 다음 행동)과 마지막 로그 줄이 함께 옵니다
4. `logs`(`id`, `out: "./dist"`, `artifacts: true`): 전체 로그와 결과물을 파일로 저장하고 경로, 크기, sha256만 답합니다
5. 멈추려면 `cancel`(`id`)

Mac은 `ends_at`에 저절로 끝나고 VM이 지워집니다. 결과물은 그 전에 받으세요. 서명, TestFlight는 검증 전입니다

전체 오류 코드: https://xenoci.com/docs/errors, CLI로 같은 일을 하려면 `xenocast --help`
