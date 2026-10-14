# XenoCI 빌드 Action (부가 기능)

XenoCI의 기본 사용법은 CLI와 MCP입니다. 셋업은 https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md 를 AI 에이전트에 보내면 됩니다. 이 Action은 그 위의 부가 기능으로, GitHub Actions 잡에서 같은 API 키 하나로 XenoCI macOS VM에 원격 빌드를 보냅니다

- 이 Action은 GitHub 러너(`ubuntu-latest` 등)에서 잡을 XenoCI VM으로 보내는 방식입니다. `runs-on`으로 지정하는 셀프 호스티드 러너가 아니며, `runs-on` 연동은 연기됐습니다
- GitHub App 설치는 필요 없습니다

## 본인 터미널에서 CLI 설치와 로그인

아래 명령을 순서대로 실행하고 `xenocast login`의 가려진 입력에 콘솔에서 발급한 API 키를 넣습니다

```sh
curl -fsSL https://github.com/Xeno-CI/xenocast/releases/latest/download/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
xenocast login
```

새 터미널에서도 명령을 쓰려면 위 `export PATH` 줄을 사용하는 셸의 설정 파일(`~/.zshrc` 또는 `~/.bashrc`)에 추가합니다

## 준비

1. 콘솔 https://xenoci.com/console 에서 크레딧을 충전하고 API 키(`xci_live_…`)를 발급합니다
2. 키를 저장소 시크릿 `XENOCI_API_KEY`에 넣습니다(키를 화면에 남기지 않으려면 `gh secret set XENOCI_API_KEY --repo owner/name` 후 키 붙여 넣기)

## 워크플로

```yaml
name: macOS 빌드
on:
  push:
  pull_request:
jobs:
  ios:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Xeno-CI/build@v1
        with:
          api-key: ${{ secrets.XENOCI_API_KEY }}
          script: ./ci.sh
          artifacts: build/*.ipa
```

Action은 키를 `::add-mask::`로 가린 뒤 CLI로 `/api/runner/v1`에 `Authorization: Bearer <키>`로 잡을 보냅니다, 토큰 교환 단계는 없습니다, 잡마다 새 macOS VM에서 돌고 끝나면 지워지며 시작한 분마다 1분으로 과금해 조직 잔액(USD)에서 차감합니다

10초는 1분, 1분 1초는 2분으로 계산합니다

## 입력

| 입력 | 필수 | 설명 |
|---|---|---|
| `api-key` | 예 | 콘솔에서 발급한 API 키, `${{ secrets.XENOCI_API_KEY }}` |
| `script` | 예 | 빌드 스크립트 파일 경로(저장소 기준) |
| `source` | | `upload`(기본, 체크아웃한 작업 폴더를 업로드) 또는 `git`(VM이 `https://github.com/<owner>/<name>.git`을 직접 받음, 공개 저장소만) |
| `xcode` | | Xcode 버전 |
| `timeout` | | 제한 시간(분), 기본 30 |
| `artifacts` | | 모을 결과물 경로(쉼표로 구분, 예: `build/*.ipa`) |
| `api-url` | | API 주소, 기본 https://xenoci.com |

- 빌드 로그가 스텝 로그로 나오고, 빌드 종료 코드가 스텝 종료 코드가 됩니다
- 잡이 끝나면 로그 끝에 `실행 125초, 과금 3분, 금액 $0.1188, 남은 잔액 $12.24` 같은 한 줄이 남습니다
- 잔액 부족(402 `insufficient_credit`), 실행 중 소진(`credit_exhausted`), 워크스페이스 지출 한도, 티어 월 한도, 동시 실행 한도(429)는 `::error title=XenoCI 잔액 소진::…충전: <링크>` 같은 한 줄을 남기고 종료 코드 3으로 끝납니다. 충전은 사람이 콘솔에서 합니다
- `api-key`가 비었거나 `xci_live_`로 시작하지 않으면 서버에 요청하지 않고 바로 실패합니다

## 포크 PR

`pull_request`는 포크에서 온 PR에 시크릿을 주지 않습니다. 그래서 포크 PR은 빌드가 실패할 뿐 키는 새지 않습니다. `pull_request_target`에서 PR 코드를 체크아웃하고 `api-key`를 넘기지 마세요. 포크 PR의 코드가 키와 함께 실행됩니다

```yaml
# 금지: 이렇게 쓰지 않는다
on: pull_request_target
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - uses: Xeno-CI/build@v1
        with:
          api-key: ${{ secrets.XENOCI_API_KEY }}
          script: ./ci.sh
```

## 다른 CI

Jenkins, GitLab, Buildkite, CircleCI, Bitrise, Azure는 CI 비밀 변수 `XENOCI_API_KEY`에 키를 넣고 XenoCast CLI를 설치한 뒤 `xenocast build --script ./ci.sh`를 실행합니다. 설치와 명령: https://github.com/Xeno-CI/xenocast
