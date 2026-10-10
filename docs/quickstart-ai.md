# AI로 약 3분 셋업

1. https://xenoci.com 에서 Mac을 빌립니다(결제는 사람이 합니다).
2. https://xenoci.com/app/api-keys 에서 API 키를 만듭니다.
3. 쓰는 AI 에이전트(Claude Code, Codex, Cursor, opencode·OMO, GJC 등 셸 명령을 실행할 수 있는 것)에 아래 주소 하나만 보냅니다.

   https://github.com/Xeno-CI/build/blob/main/SETUP.md

에이전트가 그 문서를 읽고 XenoCast CLI 설치 → API 키 질문 → `xenocast setup --no-tui --key-stdin`(키 저장, 설치된 에이전트 MCP 등록, doctor, 빌린 Mac에서 연결 확인 빌드) → 결과 보고까지 실행합니다. 사람이 할 일은 에이전트가 물을 때 키를 붙여 넣는 것입니다. 대화형 입력이 안 되는 에이전트는 시작 전에 환경 변수 `XENOCI_API_KEY`에 키를 넣어 두면 됩니다.

그다음 프로젝트 빌드, GitHub Actions의 macOS 러너 교체 등은 에이전트와 정하면 됩니다. iOS 서명·TestFlight 업로드는 아직 검증 전입니다.

직접 명령으로 하려면: [README의 CLI](../README.md) · MCP 설정: [mcp/CONNECT.md](../mcp/CONNECT.md) · Claude Code: [claude-code.md](claude-code.md)
