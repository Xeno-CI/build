# xenoci-mcp 5분 연결 (Claude Code · Codex CLI · Cursor)

## 0. AI에게 맡기기 (권장, Node 필요 없음)

https://xenoci.com/app/api-keys 의 "AI에게 맡기는 설치" 상자를 복사해 AI 채팅에 붙여 넣으면 AI가 아래 세 줄을 실행합니다. 사람이 할 일은 AI가 물을 때 콘솔에서 키를 복사하는 것 하나입니다. 키는 대화에도, AI 앱 설정 파일에도 들어가지 않고 사용자만 읽는 `~/.config/xenoci/credentials.json`(Windows `%APPDATA%\xenoci\credentials.json`, `XENOCI_CONFIG_DIR`로 바꿀 수 있음)에만 저장됩니다.

```sh
curl -fsSL https://github.com/Xeno-CI/build/releases/latest/download/install.sh | sh
# Windows PowerShell: irm https://github.com/Xeno-CI/build/releases/latest/download/install.ps1 | iex
xenoci init --from-clipboard --client codex     # claude | cursor | all, 생략하면 설치된 앱 자동 감지
xenoci doctor                                    # 키·연결·권한·빌린 맥·MCP 서버·앱 설정, 문제면 종료 코드 1
```

`init`은 키를 `GET /api/ci/v1/me`로 확인한 뒤 저장하고, 고른 앱의 설정에 `xenoci` 항목 하나만 넣습니다(다른 항목은 그대로). 넣는 명령은 `xenoci mcp`입니다.

| 앱 | 파일 |
|---|---|
| Claude Code | `~/.claude.json`의 `mcpServers.xenoci` |
| Codex CLI | `~/.codex/config.toml`(`CODEX_HOME`)의 `[mcp_servers.xenoci]` |
| Cursor | `~/.cursor/mcp.json`의 `mcpServers.xenoci` |

키를 명령줄(`--key`)로는 받지 않습니다. 클립보드를 못 읽는 환경은 `xenoci init`(입력이 안 보이는 프롬프트) 또는 `xenoci init --key-stdin`. 앱을 다시 시작하면 MCP 도구가 보입니다.

아래 1–3은 Node와 `npx`로 직접 설정하는 방법입니다.

필요한 것: Node 18 이상, CI와 iOS 공용 xeno_ci_ 프로젝트 키 하나. 키는 https://xenoci.com/app/api-keys 에서 만듭니다. 맥 주문과 빌드를 둘 다 시키려면 권한에 `build`와 `order`를 넣으세요(기본 키는 read·build·order). 키는 파일에 직접 쓰지 말고 환경 변수 `XENOCI_API_KEY`로 넘깁니다.

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

Windows PowerShell에서는 변수 참조가 `$env:XENOCI_API_KEY`입니다:

```powershell
claude mcp add xenoci --scope user --env XENOCI_API_KEY=$env:XENOCI_API_KEY -- npx -y -p github:xeno-ci/build xenoci-mcp
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

공개 도구는 `account`, `plan`, `mac`, `build`, `status`, `logs`, `diagnose`, `signing`, `ship`, `sim`, `secrets`, `webhooks`입니다. `mac.list`는 도구 `mac`에 `action: "list"`를 전달한다는 뜻입니다. 기존 개별 이름은 숨겨진 호환 별칭입니다. 각 도구에 `action: "describe", for_action: "<action>"`을 보내 정확한 스키마를 읽으세요. iOS 인수는 멱등 키와 revision까지 `input` 안에 넣고, `build.submit`의 `script`, 절대 경로 `dir`, `repo` 등은 최상위에 둡니다.

프로젝트 키의 iOS 매핑은 `read=R`, `build=W/S+createApps`, `secrets=V`, `manage=V/G/A/D`입니다. 기존 `xeno_ak_`는 iOS 호환 엔드포인트 전용입니다. 상세 권한과 관리형 iOS 흐름은 [README.md](README.md)를 참고하세요.

에이전트에게 "xenoci account 도구를 불러 줘"라고 합니다. `key.can`에 `build`·`order`가 보이면 됩니다. 오류가 나면 `error.code`를 봅니다.

| code | 뜻 | 할 일 |
|---|---|---|
| `api_key_required` | MCP 서버가 `XENOCI_API_KEY`를 못 받음 | 위 `export`를 한 셸에서 에이전트를 다시 시작. Codex는 `env_vars`, Cursor는 `${env:...}` 표기 확인 |
| `invalid_api_key` | 키가 틀렸거나 지워짐·만료 | 새 키를 만들어 교체(재시도해도 같음) |
| `insufficient_scope` | 키에 그 권한이 없음(`required_scope`, `key_can`) | 그 권한을 넣은 키를 새로 만듦 |

## 3. 첫 요청

> 이 폴더의 Swift 앱을 XenoCI에서 빌드해서 결과물을 ./dist에 받아 줘.

에이전트는 다음 순서로 진행하며 주문은 사용자 승인 후에만 요청합니다. iOS 서명과 출시는 Apple 자격증명과 별도 외부 작업이 필요할 수 있습니다.

1. `mac.list` : 이미 빌린 맥이 있으면 4로.
2. `plan.catalog` → `plan.quote` → `plan.order` : 결제 링크(`pay_url`)를 사람에게 보여 줌. 도구는 결제할 수 없음.
3. `status.order (wait: true)` : `ready`가 될 때까지 다시 부름.
4. `build.submit`: `dir`에 프로젝트 폴더의 절대 경로, `script`에 예: `xcodebuild -scheme App -destination generic/platform=iOS -archivePath build/App.xcarchive archive CODE_SIGNING_ALLOWED=NO`, `artifacts: ["build/App.xcarchive"]`(폴더는 zip으로 돌아옴). 이 결과는 unsigned archive이며 IPA가 아닙니다. 관리형 iOS 서명은 `build.archive` 후 `signing.export`를 사용하며 Apple 자격증명과 권한이 필요합니다.
   빌드 ID가 바로 돌아옵니다(빌드는 비동기). `status.build`로 `phase`(queued, receiving_source, building, finished), `elapsed_s`, `log_tail`을 확인하고, 끝나면 `exit_code`와 `duration_s`를 읽습니다. 끝날 때 알림은 `webhooks.add`(`build.completed`)로 받습니다. 끝까지 기다리는 호출이 필요하면 `wait: true`.
5. 실패하면 `logs.tail`(`mode: "failure"`) → 고쳐서 다시 `build.submit`.
6. `logs.artifacts` : 도구는 링크만 돌려줌. 에이전트가 각 `download_url`(15분 유효, 키 필요 없음)을 `curl -fLo dist/<name> "<download_url>"`로 받아 `sha256`을 비교.

맥은 `ends_at`에 저절로 끝나고 VM이 지워집니다(반납 기능은 없음). 결과물은 그 전에 받으세요.

자주 나는 오류와 다음 행동:

| code | 다음 행동 |
|---|---|
| `no_active_rental` | 맥이 없음 → 2번(주문) 또는 `build.submit`에 `queue_until_rental: true` |
| `no_capacity` | 재고 없음 → `plan.quote`의 `earliest_start_at`을 `start`로 주문하거나 `plan.waitlist` |
| `xcode_not_available` | 그 Xcode 없음 → `options` 중 하나로 다시 |
| `xcode_not_on_any_mac` | 내 맥에 그 Xcode 없음 → `mac.set_xcode` 후 다시 `build.submit` |

전체 오류 코드: https://xenoci.com/docs/errors · CLI로 같은 일을 하려면 `xenoci --help`.
