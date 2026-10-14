XenoCast 셋업

너는 이 문서를 받은 AI 에이전트다. 사용자의 컴퓨터에 XenoCast CLI(`xenocast`)를 설치하고, 사람이 비밀 저장소에 넣어 둔 API 키로 `xenocast setup`과 MCP 등록, 확인 잡까지 끝낸 뒤 증거를 붙여 완료 보고한다

읽기
0. 이 문서를 요약 도구(WebFetch 등)로 읽지 말고 `curl -fsSL https://raw.githubusercontent.com/Xeno-CI/xenocast/main/SETUP.md`로 원문을 받아 읽어라. 요약본은 명령의 플래그를 잃는다

나누는 일
- 사람이 하는 일: XenoCI 콘솔(https://xenoci.com/console)에서 크레딧 충전, API 키(`xci_live_…`) 발급, 그 키를 자기 비밀 저장소에 넣기
- 네가 하는 일: 비밀 저장소에서 키를 받아 `xenocast setup` 실행, MCP 등록, 확인 잡, 보고

규칙
- 아래 명령은 사용자에게 보여 주기만 하지 말고 네 셸 도구로 직접 실행한다. 단계마다 확인할 것을 확인한 뒤에 다음 단계로 간다
- 인증은 콘솔에서 발급한 API 키(`xci_live_…`) 하나뿐이다. 요청 헤더는 `Authorization: Bearer <키>`, 환경 변수 이름은 `XENOCI_API_KEY`
- 키를 대화로 받지 않는다. 키는 비밀 저장소에서 셸 변수로만 꺼낸다
- 키를 화면, 대화, 로그, 파일, 커밋, 빌드 스크립트, MCP 설정에 쓰지 않는다. `echo`로 키를 찍지 않는다
- 충전과 결제는 사용자가 콘솔에서 직접 한다. 너는 하지 않는다
- 단계가 실패하면 그 단계의 "실패하면"을 따른다. 같은 명령을 그대로 되풀이하지 않는다

설치
1. 설치한다. macOS, Linux:

   ```sh
   curl -fsSL https://github.com/Xeno-CI/xenocast/releases/latest/download/install.sh | XENOCAST_NO_SETUP=1 sh
   export PATH="$HOME/.local/bin:$PATH"
   ```

   Windows(PowerShell): `irm https://github.com/Xeno-CI/xenocast/releases/latest/download/install.ps1 | iex`
   설치 명령이 종료 코드 0으로 끝나면 다음으로. 실패하면 설치 출력 전체를 사용자에게 보여 준다
2. `xenocast --version`을 실행한다. 버전이 `1.6.0` 이상이면 다음으로. 명령을 못 찾으면 `export PATH="$HOME/.local/bin:$PATH"` 후 다시 확인하고, 그래도 안 되면 1의 출력을 사용자에게 보여 준다

키
3. `xenocast whoami`를 실행한다. 종료 코드 0이면 이 컴퓨터에 키가 이미 저장돼 있다. 4로 간다
   `api_key_required`이면 키를 비밀 저장소에서 꺼낸다. 사용자에게 어디에 넣었는지 한 번 묻고(키 값은 묻지 않는다) 맞는 명령으로 셸 변수 `XENOCI_API_KEY`에 담는다:
   - 이미 환경 변수 `XENOCI_API_KEY`가 있으면 그대로 쓴다
   - 키만 저장하려면 `printf %s "$XENOCI_API_KEY" | xenocast config set api-key`(표준 입력으로 받는다, 명령 인자로 넘기지 않는다). `xenocast login`은 사람이 터미널에서 쓰는 가린 입력이라 네 셸에서는 진행되지 않는다
   - macOS 키체인: `export XENOCI_API_KEY="$(security find-generic-password -a "$USER" -s XENOCI_API_KEY -w)"`
   - 1Password CLI: `export XENOCI_API_KEY="$(op read 'op://<보관함>/<항목>/credential')"`
   - 그 밖의 비밀 저장소: 그 도구의 읽기 명령 출력을 `XENOCI_API_KEY`에 담는다
   아직 넣지 않았다면 사용자에게 말한다: "콘솔 https://xenoci.com/console/keys 의 API 키 화면에서 키를 발급해 비밀 저장소에 `XENOCI_API_KEY` 이름으로 넣어 주세요(macOS는 터미널에서 `security add-generic-password -a "$USER" -s XENOCI_API_KEY -w` 후 키 붙여 넣기). 키를 대화창에 붙여 넣지 마세요" 사용자가 끝냈다고 하면 3을 다시 한다
   `invalid_api_key`이면 키가 폐기됐거나 만료됐다. 콘솔에서 새 키를 발급해 비밀 저장소의 값을 바꾸게 한다

세팅
4. `xenocast setup --no-tui --key-env XENOCI_API_KEY`를 실행한다(3에서 키가 이미 저장돼 있었다면 `xenocast setup --no-tui`)
   이 명령이 하는 일: 키 확인(조직, 워크스페이스, 권한, 잔액) → 키를 이 컴퓨터의 OS 키체인이나 암호화 파일에 저장 → 설치된 AI 에이전트(Claude Code, Cursor, Codex, opencode, OMO)에 MCP 서버 `xenoci` 등록(기존 설정은 백업 후 병합, 이미 있으면 건너뜀, 설정에 키를 넣지 않음) → MCP 서버가 저장된 키로 `whoami`에 답하는지 확인. 특정 에이전트만 등록하려면 `--agent=claude`(`cursor`, `codex`, `opencode`, `omo`)
   종료 코드 0이면 `unset XENOCI_API_KEY` 후 다음으로. 실패하면 출력의 실패 줄을 사용자에게 보여 준다. `api_key_required`나 `invalid_api_key`이면 3으로 간다

확인 잡
5. `xenocast build --script 'sw_vers && xcodebuild -version'`을 빈 임시 폴더에서 실행한다. 종료 코드 0이면 잡 ID(`job_...`), macOS, Xcode 버전, 금액을 적어 두고 다음으로. 종료 코드 3(`insufficient_credit` 등)이면 출력의 충전 링크를 사용자에게 보여 주고(충전은 사용자가 콘솔에서), 충전했다고 하면 5를 다시 한다. 그 밖의 실패는 `xenocast logs <job_id> --failure` 결과를 사용자에게 보여 주고 멈춘다

빌드 대상
6. 사용자에게 한 번 묻는다: "무엇을 빌드할까요? 1) 지금 폴더 2) 공개 GitHub 저장소(owner/name, 브랜치) 3) 나중에". 답에 맞는 명령을 정한다:
   - 지금 폴더: `xenocast build --script ./ci.sh`. 결과물은 `--artifacts 'build/*.xcarchive'` → `xenocast artifacts <job_id> --out ./dist`
   - 공개 GitHub 저장소: `xenocast build --script ./ci.sh --repo owner/name --ref main`

보고
7. 사용자에게 설치 버전, 키의 조직과 워크스페이스(키 값은 쓰지 않는다), MCP를 등록한 에이전트, 확인 잡 ID와 결과를 보고한다. AI 에이전트를 새 세션으로 시작하면 `xenoci` MCP 도구가 보인다고 알린다

부가 기능: 원격 빌드 Action
GitHub Actions에서 쓰려면 사용자가 저장소 시크릿 `XENOCI_API_KEY`에 키를 넣고(너는 키를 받지 않는다) 워크플로에 `uses: Xeno-CI/build@v1`과 `with: api-key: ${{ secrets.XENOCI_API_KEY }}`, `script: ./ci.sh`를 쓴다. GitHub 러너가 잡을 XenoCI macOS VM으로 보내는 방식이고 `runs-on` 러너가 아니다. 포크 PR을 `pull_request_target`에서 체크아웃해 키와 함께 실행하지 않는다. 자세한 내용: https://github.com/Xeno-CI/build

문서 https://xenoci.com/docs/agents/cli, MCP https://xenoci.com/docs/agents/mcp
