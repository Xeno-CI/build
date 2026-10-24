# XenoCI 빌드 Action (이전 방식)

XenoCI는 GitHub Actions 워크플로의 `runs-on`을 `xenoci-macos`로 바꿔 씁니다, XenoCI GitHub App을 GitHub 조직에 설치하면 따로 발급할 키나 시크릿이 없습니다, 연결 순서는 [빠른 시작](https://xenoci.com/docs/quickstart)에 있습니다

```yaml
jobs:
  build:
    runs-on: xenoci-macos
    steps:
      - uses: actions/checkout@v4
      - run: xcodebuild -scheme App -destination 'platform=iOS Simulator,name=iPhone 17e' test
```

이 Action(`Xeno-CI/build@v1`)은 GitHub 러너(`ubuntu-latest` 등)에서 이미 쓰던 API 키로 잡을 XenoCI VM에 보내던 이전 방식입니다, 새로 연결할 때는 위 `runs-on` 방식을 씁니다, 이미 이 Action을 쓰는 워크플로를 위해 입력과 동작을 아래에 남깁니다

## 스티키 디스크

`runs-on: xenoci-macos` 잡에서 폴더를 다음 잡까지 남기려면 `uses: Xeno-CI/build/stickydisk@v1.7.13` 을 씁니다, 입력과 예시는 [stickydisk/README.md](stickydisk/README.md)에 있습니다

## 워크플로 (이전 방식)

```yaml
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

Action은 키를 `::add-mask::`로 가린 뒤 `/api/runner/v1`에 `Authorization: Bearer <키>`로 잡을 보냅니다, 잡마다 새 macOS VM에서 돌고 끝나면 지워지며 시작한 분마다 조직 크레딧에서 차감합니다, 10초는 1분, 1분 1초는 2분으로 계산합니다

## 입력

| 입력 | 필수 | 설명 |
|---|---|---|
| `api-key` | 예 | 이미 쓰던 API 키, `${{ secrets.XENOCI_API_KEY }}` |
| `script` | 예 | 빌드 스크립트 파일 경로(저장소 기준) |
| `source` | | `upload`(기본, 체크아웃한 작업 폴더를 업로드) 또는 `git`(VM이 `https://github.com/<owner>/<name>.git`을 직접 받음, 공개 저장소만) |
| `xcode` | | Xcode 버전 |
| `timeout` | | 제한 시간(분), 기본 30 |
| `artifacts` | | 모을 결과물 경로(쉼표로 구분, 예: `build/*.ipa`) |
| `api-url` | | API 주소, 기본 https://xenoci.com |
| `env` | | 빌드 스크립트에 넘길 환경 변수, 한 줄에 `NAME=${{ secrets.X }}` 하나, 값은 스텝 로그와 잡 로그에서 `***`로 가려지고 XenoCI가 돌려주지 않음 |

- 빌드 로그가 스텝 로그로 나오고, 빌드 종료 코드가 스텝 종료 코드가 됩니다
- 잡이 끝나면 로그 끝에 실행 시간, 과금 분, 차감 크레딧, 남은 잔액이 한 줄로 남습니다
- 잔액 부족(402 `insufficient_credit`), 실행 중 소진(`credit_exhausted`), 조직 지출 한도(`organization_spend_limit`)는 `::error title=XenoCI 잔액 소진::…충전: <링크>` 같은 한 줄을 남기고 종료 코드 3으로 끝납니다, 충전은 사람이 콘솔에서 합니다
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
