# AI로 셋업

1. XenoCI [콘솔](https://xenoci.com/console)에서 크레딧을 충전하고 API 키 화면에서 키를 발급합니다
2. 키를 비밀 저장소에 `XENOCI_API_KEY` 이름으로 넣습니다(macOS는 터미널에서 `security add-generic-password -a "$USER" -s XENOCI_API_KEY -w` 후 키 붙여 넣기, 1Password 등도 됩니다). 키를 대화창에 붙여 넣지 않습니다
3. 쓰는 AI 에이전트(Claude Code, Codex, Cursor, opencode, OMO 등 셸 명령을 실행할 수 있는 것)에 아래 주소 하나만 보냅니다

   https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md


에이전트가 그 문서를 읽고 XenoCast CLI 설치, 비밀 저장소에서 키 받기, `xenocast setup --no-tui --key-env XENOCI_API_KEY`(키 확인, 키 저장, 설치된 에이전트 MCP 등록, MCP 서버 확인), 확인 잡, 결과 보고까지 실행합니다 키는 이 컴퓨터의 OS 키체인 또는 암호화 파일에 저장되고 MCP 설정에는 들어가지 않습니다

그다음 프로젝트 빌드는 에이전트와 정하면 됩니다. 부가 기능으로 GitHub Actions([Xeno-CI/build](https://github.com/Xeno-CI/build))나 다른 CI에서도 CI 비밀 변수 `XENOCI_API_KEY`로 빌드할 수 있습니다

직접 명령으로 하려면: [README의 CLI](../README.md), MCP 설정: [mcp/CONNECT.md](../mcp/CONNECT.md), Claude Code: [claude-code.md](claude-code.md)
