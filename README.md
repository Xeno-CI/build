# XenoCI GitHub Action (xeno-ci/build)

CI 토큰 하나로 XenoCI에서 빌린 macOS VM에서 빌드합니다. GitHub App 설치는 필요 없습니다. CLI, MCP 서버, AI 셋업 문서는 [Xeno-CI/xenocast](https://github.com/Xeno-CI/xenocast)로 옮겼습니다.

1. CLI를 설치하고 로그인합니다: `curl -fsSL https://github.com/Xeno-CI/xenocast/releases/latest/download/install.sh | sh` 후 `xenocast login`
2. CI 토큰을 만들어 화면을 거치지 않고 바로 저장소(또는 조직) 시크릿에 넣습니다:

   ```sh
   xenocast token --ci --name "owner/name CI" --raw | gh secret set XENOCAST_TOKEN --repo owner/name
   ```

3. 워크플로:

```yaml
name: macOS build
on:
  push:
  pull_request:        # 포크에서 온 PR에는 시크릿이 전달되지 않습니다
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: xeno-ci/build@v1
        with:
          token: ${{ secrets.XENOCAST_TOKEN }}
          script: ./ci.sh
```

- CI 토큰은 빌드 전용입니다: 빌드, 상태, 로그, 취소, Mac 목록만 되고 서명, 주문, 연장은 되지 않습니다. 기본 만료 90일, 폐기는 `xenocast token --ci --revoke <id>` 또는 웹의 로그인된 기기 화면
- Action은 토큰을 먼저 `::add-mask::`로 가리고, CLI가 `/session/refresh`에서 짧은 접근 토큰으로 바꿔 메모리에만 둡니다. 토큰은 출력되거나 저장되지 않고, 빌드 로그에 섞여 나온 토큰 모양 문자열도 가려집니다
- 예전 `api-key` 입력은 종료되었습니다. 값을 주면 단계가 "API 키는 종료되었습니다: xenocast token --ci 로 CI 토큰을 만들어 XENOCAST_TOKEN 시크릿에 넣으세요"로 실패합니다
- 포크 PR 경고: `pull_request_target`에서 PR 코드를 체크아웃하고 `XENOCAST_TOKEN`을 넘기지 마세요(포크의 코드가 시크릿과 함께 실행됩니다). 금지 예시와 다른 CI 설정은 [SETUP.md의 CI 연결](https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md)
- 소스: Action이 이 잡의 `GITHUB_TOKEN`(이 저장소 읽기 전용, 잡이 끝나면 만료)을 함께 보내고, 빌린 VM이 GitHub에서 해당 커밋만 shallow clone합니다. XenoCI는 이 토큰을 저장하거나 로그에 남기지 않으며 VM은 clone 직후 지웁니다. `actions/checkout`은 필요 없습니다
- 같은 저장소의 다음 빌드는 VM에 남은 소스에서 바뀐 부분만 받습니다. 처음부터 받으려면 CLI `--clean`
- 워크플로가 만든 파일까지 빌드하려면 `actions/checkout` 뒤에 `source: upload`를 지정합니다(작업 폴더 업로드)
- 선택 입력: `xcode`, `timeout`(분), `priority`(normal, high), `api-url`, `github-status`, `notify-url`
- 빌드 로그가 스텝 로그로 나오고, 빌드 종료 코드가 스텝 종료 코드가 됩니다. GitHub에서 잡을 취소하면 Mac의 빌드도 취소됩니다
- `pull_request` 이벤트면 PR 번호와 PR head 커밋(GitHub의 임시 merge 커밋이 아니라 PR 브랜치의 실제 커밋)을 빌드에 기록하고 그 커밋을 빌드합니다. 다른 이벤트는 `github.sha`. `xenocast watch --pr <번호> --repo owner/name`으로 그 PR의 빌드를 따라갈 수 있습니다

GitLab, Jenkins, CircleCI 등 다른 CI와 AI 에이전트(MCP) 연결은 [Xeno-CI/xenocast](https://github.com/Xeno-CI/xenocast)를 보세요
