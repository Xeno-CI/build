# Claude Code에서 XenoCast 연결

가장 짧은 방법: Claude Code에 아래 주소를 보내세요. Claude Code가 설치·로그인·MCP 등록·연결 확인 빌드까지 실행합니다.

https://gist.github.com/001005HS/54abb387f86e9007ceda038e4629ef6f

직접 하려면(키는 표준 입력으로 저장되고 MCP 설정에는 들어가지 않습니다):

```sh
curl -fsSL https://github.com/Xeno-CI/build/releases/latest/download/install.sh | sh
xenocast login --key-stdin            # 키 붙여넣기 후 Enter (https://xenoci.com/app/api-keys)
claude mcp list                       # xenoci: ... - ✔ Connected
```

Claude Code가 설치돼 있으면 `xenocast login`이 `~/.claude.json`에 `xenoci`를 함께 등록합니다("MCP 설정: claude → ..."). 목록에 없을 때만 직접 등록하세요:

```sh
claude mcp add --transport stdio --scope user xenoci -- "$(which xenocast)" mcp
```

Claude Code를 다시 시작하면 `xenoci` MCP 도구 12개(account, plan, mac, build, status, logs, diagnose, signing, ship, sim, secrets, webhooks)가 보입니다. 다른 설정 방식(`.mcp.json`, npx): [mcp/CONNECT.md](../mcp/CONNECT.md). 처음부터 전체 흐름: [quickstart-ai.md](quickstart-ai.md)
