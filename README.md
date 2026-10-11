# XenoCI 빌드 Action

빌드 전용 CI 토큰으로 XenoCI 임대 macOS VM에서 빌드합니다. GitHub App 설치는 필요 없습니다. API 키(`api-key`, `XENOCI_API_KEY`)는 종료되었습니다.

1. 로그인한 컴퓨터에서 CI 토큰을 만들어 화면을 거치지 않고 시크릿에 넣습니다.

```sh
xenocast token --ci --raw | gh secret set XENOCAST_TOKEN --repo owner/name
```

2. 워크플로에 `token: ${{ secrets.XENOCAST_TOKEN }}`을 넘깁니다. 매 실행은 `POST /api/ci/v1/session/refresh`로 짧은 접근 토큰을 받고, CI 토큰과 접근 토큰을 모두 `::add-mask::`로 가린 뒤 빌드합니다. CI 토큰은 빌드 전용입니다(빌드, 상태, 로그, 취소, Mac 목록만. 서명, 주문, 연장 불가).

```yaml
name: macOS 빌드
on:
  push:
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: xeno-ci/build@v1
        with:
          token: ${{ secrets.XENOCAST_TOKEN }}
          script: ./ci.sh
```

예전 `with: api-key`는 바로 실패합니다. 안내: `API 키는 종료되었습니다: xenocast token --ci --raw | gh secret set XENOCAST_TOKEN`. 설정: https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md

## 포크 PR

`pull_request`는 포크에서 온 PR에 시크릿을 주지 않습니다. 그래서 포크 PR은 빌드가 건너뛰어지거나 실패할 뿐 토큰은 새지 않습니다. `pull_request_target`에서 PR 코드를 체크아웃하고 `XENOCAST_TOKEN`을 넘기지 마세요. 포크 PR의 코드가 시크릿과 함께 실행됩니다.

```yaml
# 금지: 이렇게 쓰지 않는다
on: pull_request_target
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - uses: xeno-ci/build@v1
        with:
          token: ${{ secrets.XENOCAST_TOKEN }}
          script: ./ci.sh
```

- 소스: Action이 이 잡의 `GITHUB_TOKEN`(이 저장소 읽기 전용, 잡이 끝나면 만료)을 함께 보내고, 임대 VM이 GitHub에서 해당 커밋만 shallow clone합니다. XenoCI는 이 토큰을 저장하거나 로그에 남기지 않으며 VM은 clone 직후 지웁니다. `actions/checkout`은 필요 없습니다.
- 같은 저장소의 다음 빌드는 VM에 남은 소스에서 바뀐 부분만 받습니다. 처음부터 받으려면 CLI `--clean`.
- 워크플로가 만든 파일까지 빌드하려면 `actions/checkout` 뒤에 `source: upload`를 지정합니다(작업 폴더 업로드).
- 선택 입력: `xcode`, `timeout`(분), `priority`(normal/high), `api-url`.
- 빌드 로그가 스텝 로그로 나오고, 빌드 종료 코드가 스텝 종료 코드가 됩니다.
- `pull_request` 이벤트면 PR 번호와 PR head 커밋(GitHub의 임시 merge 커밋이 아니라 PR 브랜치의 실제 커밋)을 빌드에 기록하고 그 커밋을 빌드합니다. 다른 이벤트는 `github.sha`. 나중에 `GET /api/ci/v1/builds?pr=번호`, `?repo=owner/name`으로 찾을 수 있습니다(`source: upload`도 저장소 이름이 표시·검색용으로 기록됨).
- 서명 인증서·암호는 임대 화면의 **빌드 시크릿**에 저장하면 빌드 환경 변수로 들어가고 로그에서 가려집니다.

## CLI

CI에서는 저장된 로그인 대신 `XENOCAST_TOKEN`을 읽습니다. CLI가 `/session/refresh`로 접근 토큰을 받고 자격 저장소에는 쓰지 않습니다.

```bash
export XENOCAST_TOKEN=...
npx -y -p github:xeno-ci/xenocast xenocast build --script ./ci.sh --wait
npx -y -p github:xeno-ci/xenocast xenocast build --script ./ci.sh --repo-url https://gitlab.com/group/app --ref main --wait
npx -y -p github:xeno-ci/xenocast xenocast macs
npx -y -p github:xeno-ci/xenocast xenocast status rb_...
npx -y -p github:xeno-ci/xenocast xenocast logs rb_... --wait
npx -y -p github:xeno-ci/xenocast xenocast cancel rb_...
```

`build`는 PR 번호와 커밋을 자동으로 붙입니다: `--pr`/`--commit`을 주지 않으면 CI 변수(GitHub Actions 이벤트, Jenkins `CHANGE_ID`·`GIT_COMMIT`, GitLab `CI_MERGE_REQUEST_IID`·`CI_COMMIT_SHA`, Buildkite, CircleCI, Bitrise, Azure)와 `git rev-parse HEAD`를 씁니다. `--dir`와 `--repo owner/name`을 같이 주면 폴더를 올리고 저장소 이름은 표시·검색용으로만 씁니다.

CI별 예제(Jenkins, GitLab, Buildkite, CircleCI, Bitrise, Azure, 로컬)는 `XENOCAST_TOKEN`을 쓰고 `xenocast build --script ./ci.sh`를 실행합니다. 설정: https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md

## MCP (Claude Code · Cursor)

MCP 설정에는 토큰을 넣지 않습니다. 이 컴퓨터의 로그인(`xenocast login`)을 `xenocast mcp`가 읽습니다.

```bash
claude mcp add xenoci -- npx -y -p github:xeno-ci/xenocast xenoci-mcp
```

Cursor `.cursor/mcp.json`:

```json
{ "mcpServers": { "xenoci": { "command": "npx", "args": ["-y", "-p", "github:xeno-ci/xenocast", "xenoci-mcp"] } } }
```

도구: `build`, `status`, `cancel`, `logs`, `macs`.
