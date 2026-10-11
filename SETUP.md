XenoCast 셋업

너는 이 문서를 받은 AI 에이전트다. 사용자의 컴퓨터에 XenoCast CLI(`xenocast`)를 설치하고, GitHub 로그인을 마치고, 빌린 Mac에서 연결 확인 빌드가 성공할 때까지 끝낸 뒤, 증거를 붙여 완료 보고한다. 약 3분 걸린다.

읽기
0. 이 문서를 요약 도구(WebFetch 등)로 읽지 말고 `curl -fsSL https://raw.githubusercontent.com/Xeno-CI/xenocast/main/SETUP.md`로 원문을 받아 읽어라. 요약본은 명령의 플래그를 잃는다.

규칙
- 아래 명령은 사용자에게 보여 주기만 하지 말고 네 셸 도구로 직접 실행한다. 단계마다 확인할 것을 확인한 뒤에 다음 단계로 간다.
- 사용자가 직접 하는 일은 GitHub 로그인 승인과 웹에서 Mac 구매뿐이다. 설치와 CI 연결은 AI가 실행하며 필요한 빌드 대상·CI·시크릿 저장 위치만 확인한다.
- API 키는 종료되었다. 사용자에게 키를 묻지 않는다. 로그인은 `xenocast login`이 연 링크에서 사용자가 GitHub으로 승인하는 방식뿐이다.
- 토큰(`xeno_at_`, `xeno_rt_`, `xeno_ci_`로 시작하는 값)을 화면, 대화, 로그, 파일, 커밋, 빌드 스크립트에 쓰지 않는다. 로그인은 OS 키체인 또는 암호화 파일에 저장되고 MCP 설정에는 들어가지 않는다.
- 주문, 결제, 연장은 사용자가 직접 한다. 너는 하지 않는다.
- iOS 서명, archive 서명 export, TestFlight 업로드는 아직 검증 전이다. 이 세팅에서 시도하지 않는다.
- 단계가 실패하면 그 단계의 "실패하면"을 따른다. 같은 명령을 그대로 되풀이하지 않는다.

설치
1. 설치한다. macOS, Linux:

   ```sh
   curl -fsSL https://github.com/Xeno-CI/xenocast/releases/latest/download/install.sh | sh
   export PATH="$HOME/.local/bin:$PATH"
   ```

   Windows(PowerShell): `irm https://github.com/Xeno-CI/xenocast/releases/latest/download/install.ps1 | iex`
   설치 명령이 종료 코드 0으로 끝나면 다음으로. 실패하면 설치 출력 전체를 사용자에게 보여 준다.
2. `xenocast --version`을 실행한다. 버전이 `1.4.1` 이상이면 다음으로. 명령을 못 찾으면 `export PATH="$HOME/.local/bin:$PATH"` 후 다시 확인하고, 그래도 안 되면 1의 출력을 사용자에게 보여 준다.

로그인
3. `xenocast whoami`를 실행한다. 종료 코드 0이면 이미 로그인돼 있다. 4로 간다.
   아니면 로그인을 백그라운드로 실행한다(끝날 때까지 기다리는 명령이다):

   ```sh
   xenocast login --json > xenocast-login.out 2> xenocast-login.err &
   ```

   `xenocast-login.err`의 첫 줄은 `{"event":"device_code","verification_uri_complete":"...","user_code":"...","expires_in":600}`이다. 이 줄이 생기면 사용자에게 말한다: "이 링크를 열고 GitHub으로 로그인한 뒤 승인해 주세요: <verification_uri_complete> (화면의 코드가 <user_code>인지 확인)". 가입이 안 돼 있으면 이때 가입된다.
   로그인 명령이 끝날 때까지 기다린다. 종료 코드 0이면 `xenocast-login.out`의 JSON에서 `account.email_masked`와 `rentals`를 확인하고, 두 파일을 지운 뒤 다음으로. 실패하면:
   - `access_denied`: 사용자가 거부했다. 계속할지 묻고, 원하면 3을 다시 한다.
   - `expired_token`: 10분이 지났다. 3을 한 번 더 하고 이번엔 사용자에게 바로 링크를 전한다.
   - 그 밖: `xenocast-login.err`의 마지막 줄을 사용자에게 보여 준다.

Mac
4. `xenocast macs`를 실행한다. 빌린 Mac이 한 대 이상이면 다음으로. "Mac을 빌려 주세요"이면 사용자에게 https://xenoci.com/app/store 에서 Mac을 빌려 달라고 말하고(너는 주문하지 않는다), 결제가 끝났다고 하면 4를 다시 한다.
   어떤 Mac 줄 아래에 "남은 시간 6시간 이하"가 보이면 그 줄을 사용자에게 그대로 전한다(연장은 사용자가 한다).

세팅
5. `xenocast setup --no-tui`를 실행한다.
   이 명령이 하는 일: 로그인 확인 → 이 컴퓨터에 설치된 AI 에이전트(Claude Code, Cursor, Codex, opencode, OMO)에 MCP 서버 `xenoci` 등록(기존 설정은 백업 후 병합, 이미 있으면 건너뜀, 설정에 토큰을 넣지 않음) → `doctor` 점검 → 빌린 Mac에서 연결 확인 빌드(`sw_vers`, `xcodebuild -version`). 특정 에이전트만 등록하려면 `--agent=claude`(`cursor`, `codex`, `opencode`, `omo`).
   종료 코드 0이면 다음으로. 실패하면 출력의 실패 줄을 따른다:
   - `login_required`, `reauth_required`: 로그인이 없거나 만료, 폐기됐다. 3의 로그인을 다시 한다.
   - `no_active_rental`: 4로 간다.
   - 빌드 실패: 7로 간다.

점검
6. `xenocast doctor`를 실행한다. 종료 코드 0이면 결과 줄 몇 개(`OK   login ...` 포함)를 보고용으로 적어 두고 다음으로. 종료 코드 1이면 문제 줄을 사용자에게 보여 주고, 로그인 문제는 3, Mac 문제는 4를 따른다.

연결 확인 빌드
7. 5의 출력에서 연결 확인 빌드 ID(`rb_...`)를 찾아 `xenocast status <rb_id>`를 실행한다. 상태가 `succeeded`이면 빌드 ID, Mac의 macOS, Xcode 버전을 적어 두고 다음으로. 실패했으면 `xenocast diagnose <rb_id>` 결과를 사용자에게 보여 주고 멈춘다.

빌드 대상
8. 사용자에게 한 번 묻는다: "무엇을 빌드할까요? 1) 지금 폴더 2) GitHub 저장소(owner/name, 브랜치) 3) CI에 연결 4) 나중에". 답에 맞는 명령을 정한다:
   - 지금 폴더: `xenocast build --script ./ci.sh` 또는 짧은 명령은 `xenocast build --script 'xcodebuild -version'`. 결과물은 `--artifacts 'build/*.xcarchive'` → `xenocast artifacts <rb_id> --out ./dist`
   - GitHub 저장소: `xenocast build --script ./ci.sh --repo owner/name --ref main`
   - CI에 연결: 아래 "CI 연결"을 따른다
   - 나중에, 또는 답이 없으면: 빌드하지 않고 다음으로
   사용자가 지금 돌리라고 하면 그 명령을 실행하고, 종료 코드(= 빌드 종료 코드)와 빌드 ID를 적어 두고 다음으로. 실패하면 `xenocast diagnose <rb_id>` 결과를 보여 준다.

완료 보고
9. 사용자에게 알린다: 로그인한 계정(가려진 이메일), 연결 확인 빌드 ID(`rb_...`)와 결과, Mac의 macOS, Xcode 버전과 남은 시간, MCP를 등록한 에이전트 목록(새 세션부터 `xenoci` 도구 5개 build, status, cancel, logs, macs가 보인다), 8에서 정한 빌드 대상과 명령.
   완료라고 말할 때는 증거를 반드시 붙인다: 연결 확인 빌드의 job id(`rb_...`)와 상태 `succeeded`, `xenocast doctor` 출력의 결과 줄 몇 개. 증거 없이 "다 됐다"고만 쓰지 않는다. 토큰 값은 붙이지 않는다.
10. 그다음 한 번만 묻는다: "XenoCast 저장소(Xeno-CI/xenocast)에 GitHub 스타를 누를까요?"
   - 사용자가 yes라고 답했을 때만 `gh api -X PUT user/starred/Xeno-CI/xenocast`를 실행한다(`gh repo star`가 없는 gh 버전이 있다).
   - `gh`가 없거나 로그인돼 있지 않으면 링크 https://github.com/Xeno-CI/xenocast 만 알려 주고 넘어간다.
   - 묻지 않고 누르지 않는다. no거나 답이 없으면 아무것도 하지 않는다.

CI 연결
CI에서는 로그인 대신 CI 토큰을 쓴다. CI 토큰은 빌드 전용이다: 빌드 실행, 상태, 로그, 취소, Mac 목록만 되고 서명, 주문, 연장은 되지 않는다. 기본 만료 90일이고 `xenocast token --ci --revoke <id>` 또는 웹의 로그인된 기기 화면에서 폐기한다.
C1. 먼저 사용하는 CI와 토큰을 넣을 저장소 또는 조직을 사용자에게 확인한다. 로그인한 컴퓨터에서 토큰을 만들어 화면을 거치지 않고 바로 시크릿에 넣는다. GitHub 저장소라면:

   ```sh
   xenocast token --ci --raw | gh secret set XENOCAST_TOKEN --repo owner/name
   # 이름과 조직도 같다: xenocast token --ci --name "owner/name CI" --raw | gh secret set XENOCAST_TOKEN --org <org> --visibility all
   ```

   GitLab은 `xenocast token --ci --raw | glab variable set XENOCAST_TOKEN --masked --protected`로 넣는다. Jenkins CLI 접근이 있으면 Secret text 자격 XML 생성 파이프의 stdin으로 토큰을 받아 `create-credentials-by-xml system::system::jenkins _`에 전달한다. 토큰을 argv나 임시 파일에 넣지 않는다. 다른 CI는 해당 CLI의 시크릿 stdin 입력을 사용한다. CLI 접근이 없을 때만 사람이 자신의 터미널에서 `xenocast token --ci --raw`를 실행해 해당 CI의 비밀 입력 화면에 넣는다. AI는 그 값을 받지 않는다. `--raw`만 원문을 출력하며 기본·`--json` 출력은 안전한 세션 정보뿐이다.
C2. 쓰는 CI에 맞는 설정을 넣는다:
   - GitHub Actions: `runs-on: macos-*` 잡을 `xeno-ci/build@v1` 액션으로 바꾼다.

     ```yaml
     on:
       push:
       pull_request:        # 포크에서 온 PR에는 시크릿이 전달되지 않는다(그래서 안전하다)
     jobs:
       ios:
         runs-on: ubuntu-latest
         steps:
           - uses: xeno-ci/build@v1
             with:
               token: ${{ secrets.XENOCAST_TOKEN }}
               script: ci.sh
     ```

   - GitLab CI: 프로젝트 Settings → CI/CD → Variables에 `XENOCAST_TOKEN`(Masked, Protected)

     ```yaml
     ios:
       image: node:24
       script:
         - curl -fsSL https://github.com/Xeno-CI/xenocast/releases/latest/download/install.sh | sh
         - ~/.local/bin/xenocast build --script ./ci.sh
     ```

     `xenocast build`는 체크아웃된 작업 폴더를 올려 빌드한다
   - Jenkins: Credentials에 Secret text `XENOCAST_TOKEN`을 만들고

     ```groovy
     withCredentials([string(credentialsId: 'XENOCAST_TOKEN', variable: 'XENOCAST_TOKEN')]) {
       sh 'curl -fsSL https://github.com/Xeno-CI/xenocast/releases/latest/download/install.sh | sh'
       sh '~/.local/bin/xenocast build --script ./ci.sh'
     }
     ```

   - 그 밖(CircleCI, Buildkite, Bitrise, Azure Pipelines 등): 비밀 변수 `XENOCAST_TOKEN`을 두고 위와 같이 설치 후 `xenocast build --script ./ci.sh`. 종료 코드 = 빌드 종료 코드다.
C3. 포크 PR 경고. 공개 저장소에서 남의 코드가 토큰을 읽지 못하게 한다:
   - `pull_request` 이벤트는 포크에서 온 PR에 시크릿을 주지 않는다. 포크 PR은 빌드가 건너뛰어지거나 실패할 뿐 토큰은 새지 않는다. 이대로 둔다.
   - `pull_request_target`에서 PR 코드를 체크아웃하고 `XENOCAST_TOKEN`을 쓰지 않는다. 아래는 금지 예시다(포크 PR의 코드가 시크릿과 함께 실행된다):

     ```yaml
     # 금지: 이렇게 쓰지 않는다
     on: pull_request_target
     jobs:
       ios:
         runs-on: ubuntu-latest
         steps:
           - uses: actions/checkout@v5
             with:
               ref: ${{ github.event.pull_request.head.sha }}
           - uses: xeno-ci/build@v1
             with:
               token: ${{ secrets.XENOCAST_TOKEN }}
               script: ci.sh
     ```

   - GitLab은 `XENOCAST_TOKEN`을 Protected로 둬 보호 브랜치에서만 쓰이게 하고, 포크 MR 파이프라인을 상위 프로젝트에서 돌리지 않는다. Jenkins는 포크 PR 빌드에 자격 증명을 주지 않는다(GitHub Branch Source의 "Trust" 설정을 "Nobody" 또는 "Collaborators"로).
   - CLI는 토큰 원문을 출력하지 않고 빌드 로그의 토큰도 `[REDACTED]`로 가린다. 액션은 GitHub의 `::add-mask::`로 CI 토큰과 접근 토큰을 등록한다. 빌드 스크립트에서 `XENOCAST_TOKEN`을 출력하지 않는다.
C4. 사용자에게 시크릿을 넣은 곳과 토큰 ID를 알리고, 첫 CI 실행의 빌드 ID와 결과를 함께 보고한다.

이후 (방향만)
세팅은 여기까지다. 무엇을 할지는 사용자와 정한다.
- 상태, 로그, 실패 분석: `xenocast status | logs | diagnose | watch`, 남은 시간 `xenocast macs`(6시간 이하면 연장 명령이 함께 보인다), 연장 `xenocast extend <rt_id>`(결제 링크가 열린다, 결제는 사람이), 점검 `xenocast doctor`, 전체 `xenocast --help`
- 로그아웃: `xenocast logout`(서버에서도 폐기)
- 서명, TestFlight(`xenocast ios archive|sign|ship`)는 검증 전이다

문서 https://github.com/Xeno-CI/xenocast, GitHub Action https://github.com/Xeno-CI/build, 오류 코드 https://xenoci.com/docs/errors, OpenAPI https://xenoci.com/openapi.json
