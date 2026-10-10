# AI로 약 3분 셋업

1. 쓰는 AI 에이전트(Claude Code, Codex, Cursor, opencode, OMO, GJC 등 셸 명령을 실행할 수 있는 것)에 아래 주소 하나만 보냅니다.

   https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md

2. 에이전트가 로그인 링크를 보여 주면 열어서 GitHub으로 로그인하고 승인합니다(처음이면 이때 가입됩니다).
3. Mac을 아직 빌리지 않았다면 https://xenoci.com/app/store 에서 빌립니다(결제는 사람이 합니다).

에이전트가 그 문서를 읽고 XenoCast CLI 설치, `xenocast login`, `xenocast setup --no-tui`(설치된 에이전트 MCP 등록, doctor, 빌린 Mac에서 연결 확인 빌드), 결과 보고까지 실행합니다. API 키는 쓰지 않습니다. 로그인은 이 컴퓨터의 OS 키체인 또는 암호화 파일에 저장되고 MCP 설정에는 들어가지 않습니다.

그다음 프로젝트 빌드, GitHub Actions나 GitLab, Jenkins 연결(CI 토큰 `XENOCAST_TOKEN`)은 에이전트와 정하면 됩니다. iOS 서명, TestFlight 업로드는 아직 검증 전입니다.

직접 명령으로 하려면: [README의 CLI](../README.md), MCP 설정: [mcp/CONNECT.md](../mcp/CONNECT.md), Claude Code: [claude-code.md](claude-code.md)
