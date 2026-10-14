# Claude Code에서 XenoCast 연결

가장 짧은 방법: Claude Code에 아래 주소를 보내세요. Claude Code가 설치, 키 저장, MCP 등록, 확인 잡까지 실행합니다. 사람은 콘솔에서 충전하고 API 키를 발급해 비밀 저장소에 `XENOCI_API_KEY` 이름으로 넣어 둡니다

https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md

직접 하려면(키는 OS 키체인 또는 암호화 파일에 저장되고 MCP 설정에는 들어가지 않습니다)

```sh
curl -fsSL https://github.com/Xeno-CI/xenocast/releases/latest/download/install.sh | XENOCAST_NO_SETUP=1 sh
export XENOCI_API_KEY="$(security find-generic-password -a "$USER" -s XENOCI_API_KEY -w)"   # 비밀 저장소에서 키 꺼내기(macOS 예)
xenocast setup --no-tui --key-env XENOCI_API_KEY   # 키 확인 + 키 저장 + MCP 등록 + MCP 서버 확인
unset XENOCI_API_KEY
claude mcp list                       # xenoci: ... - ✔ Connected
```

Claude Code가 설치돼 있으면 `xenocast setup`이 `~/.claude.json`에 `xenoci`를 등록합니다. 목록에 없을 때만 직접 등록하세요

```sh
claude mcp add --transport stdio --scope user xenoci -- "$(which xenocast)" mcp
```

Claude Code를 다시 시작하면 `xenoci` MCP 도구 11개(build, status, cancel, logs, list_runners, whoami, credits, usage, failure, compare, search_log)가 보입니다. 다른 설정 방식: [mcp/CONNECT.md](../mcp/CONNECT.md), 처음부터 전체 흐름: [quickstart-ai.md](quickstart-ai.md)
