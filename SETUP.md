이 문서를 요약 도구(WebFetch 등)로 읽지 말고 `curl -fsSL https://raw.githubusercontent.com/Xeno-CI/build/main/SETUP.md`로 원문을 받아 읽어라. 요약본은 명령의 플래그를 잃는다.

이 문서를 받은 AI 에이전트는 아래를 순서대로 실행한다.

아래 명령은 사용자에게 보여 주기만 하지 말고 에이전트가 자기 셸 도구로 직접 실행한다. 사용자에게는 API 키 입력만 부탁한다.

# XenoCI 초기 세팅 (에이전트 실행용)

목표: 사용자의 컴퓨터에 XenoCast CLI(`xenocast`)를 설치하고, `xenocast setup` 한 번으로 키 저장·MCP 등록·점검·연결 확인 빌드까지 끝낸 뒤 결과를 보고한다. 약 3분 걸린다.

규칙:
- API 키를 화면·로그·파일·커밋·빌드 스크립트에 출력하거나 쓰지 않는다. 명령줄 인수(`--key ...`)로 넘기지 않고 표준 입력이나 환경 변수로만 넘긴다.
- 주문·결제·연장은 사용자가 직접 한다. 에이전트가 하지 않는다.
- iOS 서명, archive 서명 export, TestFlight 업로드는 아직 검증 전이다. 이 세팅에서 시도하지 않는다.

## 1. 설치

macOS·Linux:

```sh
curl -fsSL https://github.com/Xeno-CI/build/releases/latest/download/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
xenocast --version
```

Windows(PowerShell): `irm https://github.com/Xeno-CI/build/releases/latest/download/install.ps1 | iex` 후 `xenocast --version`.

버전이 `1.3.2` 이상이면 다음으로 간다. 실패하면 설치 출력 전체를 사용자에게 보여 준다.

## 2. 사용자에게 API 키 묻기

환경 변수 `XENOCI_API_KEY`가 이미 있으면 묻지 않는다.

없으면 사용자에게 묻는다: "XenoCI API 키를 붙여 넣어 주세요. https://xenoci.com/app/api-keys 에서 만들 수 있습니다. 대화에 붙인 키는 이 대화 기록에 남습니다. 남기기 싫으면 직접 터미널에서 `xenocast setup`을 실행해 주세요."

Mac을 아직 빌리지 않았다면 https://xenoci.com/app/store 에서 빌려 달라고 같이 말한다(에이전트는 주문하지 않는다).

## 3. `xenocast setup` 실행

받은 키를 표준 입력으로 넘긴다(`<키>` 자리에 넣고, 출력하지 않는다):

```sh
printf '%s\n' '<키>' | xenocast setup --no-tui --key-stdin
```

`XENOCI_API_KEY`가 있으면 `xenocast setup --no-tui`만 실행한다.

이 명령이 하는 일: 키 확인·저장 → 이 컴퓨터에 설치된 AI 에이전트(Claude Code, Cursor, Codex, opencode, OMO)에 MCP 서버 `xenoci` 등록(기존 설정은 백업 후 병합, 이미 있으면 건너뜀, 설정에 키를 넣지 않음) → `doctor` 점검 → 빌린 Mac에서 연결 확인 빌드(`sw_vers`, `xcodebuild -version`). 특정 에이전트만 등록하려면 `--agent=claude`(`cursor`, `codex`, `opencode`, `omo`). 종료 코드 0이면 성공이다.

실패하면 출력의 실패 줄을 따른다:
- `invalid_api_key`: 키가 틀렸거나 폐기·만료됐다. 사용자에게 새 키를 받는다. 같은 키로 다시 하지 않는다.
- `no_active_rental`: 사용자에게 Mac을 빌려 달라고 하고, 결제가 끝나면 3을 다시 실행한다.
- 빌드 실패: 출력의 `xenocast diagnose <rb_id>` 결과를 사용자에게 보여 준다.

## 4. 결과 보고

사용자에게 알린다: 연결 확인 빌드 ID(`rb_...`)와 결과, Mac의 macOS·Xcode 버전, MCP를 등록한 에이전트 목록(새 세션부터 `xenoci` 도구가 보인다).

완료라고 말할 때는 증거를 짧게 붙인다: 연결 확인 빌드의 job id(`rb_...`)와 상태 `succeeded`, `xenocast doctor` 출력에서 결과 줄 몇 개. 증거 없이 "다 됐다"고만 쓰지 않는다. 키 값은 붙이지 않는다.

그다음 한 번만 묻는다: "XenoCast 저장소(Xeno-CI/build)에 GitHub 스타를 누를까요?"
- 사용자가 yes라고 답했을 때만 `gh api -X PUT user/starred/Xeno-CI/build`를 실행한다(`gh repo star`가 없는 gh 버전이 있다).
- `gh`가 없거나 로그인돼 있지 않으면 링크 https://github.com/Xeno-CI/build 만 알려 주고 넘어간다.
- 묻지 않고 누르지 않는다. no거나 답이 없으면 아무것도 하지 않는다.

## 5. 이후 (방향만)

세팅은 여기까지다. 무엇을 할지는 사용자와 정한다.

- 현재 폴더 빌드: `xenocast build --script ./ci.sh` 또는 짧은 명령은 `xenocast build --script 'xcodebuild -version'`. 결과물은 `--artifacts 'build/*.xcarchive'` → `xenocast artifacts <rb_id> --out ./dist`
- GitHub 저장소: `xenocast build --script ./ci.sh --repo owner/name --ref main`
- GitHub Actions의 macOS 러너는 `xeno-ci/build@v1` 액션으로 바꿀 수 있다: https://github.com/Xeno-CI/build#github-actions
- 상태·로그·실패 분석: `xenocast status | logs | diagnose | watch`, 남은 시간 `xenocast macs`, 점검 `xenocast doctor`, 전체 `xenocast --help`
- 서명·TestFlight(`xenocast ios archive|sign|ship`)는 검증 전이다.

문서: https://github.com/Xeno-CI/build · 오류 코드 https://xenoci.com/docs/errors · OpenAPI https://xenoci.com/openapi.json
