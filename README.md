<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/xenocast-dark.svg">
  <img src=".github/assets/xenocast-light.svg" alt="XenoCast for GitHub Actions" width="320">
</picture>

# XenoCast for GitHub Actions

**내 워크플로에서 빌린 Mac으로 바로 빌드**

[![Release](https://img.shields.io/github/v/release/Xeno-CI/build?style=flat-square&color=2563eb)](https://github.com/Xeno-CI/build/releases) [![MIT License](https://img.shields.io/badge/license-MIT-475569?style=flat-square)](LICENSE) [![Docs](https://img.shields.io/badge/docs-xenoci.com-2563eb?style=flat-square)](https://xenoci.com/docs) [![Downloads](https://img.shields.io/github/downloads/Xeno-CI/xenocast/total?style=flat-square&color=475569)](https://github.com/Xeno-CI/xenocast/releases)

[한국어](README.md) | [English](README.en.md)

</div>

## 설치

macOS와 Linux

```sh
curl -fsSL https://xenoci.com/install.sh | sh
```

Windows PowerShell

```powershell
irm https://xenoci.com/install.ps1 | iex
```

설치 한 줄이 GitHub 로그인, MCP 등록, 빌린 Mac에서 연결 확인 빌드까지 이어지며 로그인 링크에서 직접 승인하면 됩니다

연결 확인 빌드에는 [대여 중인 Mac](https://xenoci.com/app/store)이 필요하며 대여와 결제는 직접 진행합니다

## AI에게 이 한 줄

Claude Code, Codex, Cursor, opencode에 그대로 붙여 넣으세요

> https://raw.githubusercontent.com/Xeno-CI/xenocast/main/SETUP.md 를 읽고 이 컴퓨터에 XenoCast를 설정해 줘, GitHub 승인 링크를 보여 주고 빌린 Mac에서 연결 확인 빌드까지 검증해 줘

[셋업 안내](https://raw.githubusercontent.com/Xeno-CI/xenocast/main/SETUP.md)에 현재 릴리스 설치 명령과 오류별 다음 행동이 있어 AI가 지금 바로 전체 설정을 진행할 수 있습니다

## 왜 XenoCast

**Mac 없이 Windows에서 iOS 빌드**
프로젝트를 빌린 Mac mini M4로 보내 빌드합니다
Xcode는 원격 Mac에서 실행하고, 나는 Windows나 Linux, macOS에서 작업합니다

**내 AI가 빌드부터 로그 확인까지**
MCP 도구 다섯 개로 빌드, 상태, 취소, 로그, Mac 목록을 다룹니다
대화하던 AI가 작업을 시작하고 로그를 읽고 필요하면 취소합니다

**공유 러너가 아닌 내 대여 Mac**
공유 CI 러너 대신 내 대여에 배정된 Mac에서 빌드합니다
`xenocast macs`로 Xcode 버전과 남은 대여 시간을 확인합니다

**기존 CI에 빌드 전용 토큰 하나**
GitHub Actions, GitLab, Jenkins에서 CI 토큰으로 연결합니다
빌드와 상태, 로그, 취소, Mac 조회만 허용하고 서명이나 주문, 연장 권한은 주지 않습니다

**서명과 TestFlight는 준비 중**
원격 빌드와 결과물 다운로드는 지금 사용할 수 있습니다
관리형 iOS 서명과 TestFlight 업로드는 이 셋업에서 아직 검증 전이므로 릴리스 배포 경로로 사용하지 않습니다

## 워크플로에 연결

GitHub App 설치 없이 빌드 전용 CI 토큰으로 연결합니다
먼저 위의 셋업을 마친 컴퓨터에서 토큰을 시크릿으로 바로 보냅니다

```sh
xenocast token --ci --raw | gh secret set XENOCAST_TOKEN --repo owner/name
```

저장소에 `ci.sh`를 준비한 뒤 워크플로를 추가합니다
포크 PR은 잡을 건너뛰고, 같은 저장소의 PR과 push에서 실행합니다

```yaml
name: macOS build
on:
  push:
  pull_request:
permissions:
  contents: read
jobs:
  build:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - uses: xeno-ci/build@v1
        with:
          token: ${{ secrets.XENOCAST_TOKEN }}
          script: ./ci.sh
```

기본 `source: git`은 Mac이 해당 커밋을 직접 가져오므로 `actions/checkout`이 필요 없습니다
빌드 로그는 스텝 로그에 나오고 원격 빌드 종료 코드가 스텝 종료 코드가 됩니다

## 입력

| 입력 | 기본값 | 용도 |
| --- | --- | --- |
| `token` | 필수 | `secrets.XENOCAST_TOKEN`의 빌드 전용 토큰 |
| `script` | 필수 | 저장소 기준 빌드 스크립트 경로 |
| `source` | `git` | 커밋 가져오기 또는 `upload`로 작업 폴더 업로드 |
| `xcode` | 미지정 | 사용할 Xcode 버전 |
| `timeout` | `30` | 제한 시간, 분 단위 |
| `priority` | `normal` | `normal` 또는 `high` |
| `api-url` | `https://xenoci.com` | API 주소 |
| `github-status` | `false` | 커밋 상태 기록, `statuses: write` 권한 필요 |
| `notify-url` | 미지정 | 빌드 알림을 받을 HTTPS URL |

<details>
<summary>워크플로에서 만든 파일도 빌드하기</summary>

체크아웃 이후 파일을 생성하는 스텝을 넣고 `source: upload`를 사용합니다

```yaml
steps:
  - uses: actions/checkout@v5
  - uses: xeno-ci/build@v1
    with:
      token: ${{ secrets.XENOCAST_TOKEN }}
      script: ./ci.sh
      source: upload
```

`git` 모드는 같은 저장소의 다음 빌드에서 바뀐 소스만 가져옵니다
`pull_request`에서는 임시 merge 커밋이 아닌 PR head 커밋을 빌드하고 PR 번호를 기록합니다
`upload`에서도 저장소 이름을 표시와 검색용으로 기록합니다

</details>

<details>
<summary>CI 토큰과 포크 PR 보안</summary>

CI 토큰은 기본 90일 후 만료하며 서명, 주문, 연장 권한이 없습니다
각 실행에서 짧은 접근 토큰으로 교환하고 CI 토큰과 접근 토큰을 GitHub 로그에서 가립니다
소스를 가져올 때 쓰는 이 잡의 `GITHUB_TOKEN`은 저장하거나 로그에 남기지 않고 Mac에서 clone 직후 지웁니다

포크 PR에는 시크릿을 전달하지 않습니다
`pull_request_target`에서 외부 PR 코드를 체크아웃하고 CI 토큰을 넘기면 안 됩니다
GitLab은 토큰을 Masked, Protected로 두고 Jenkins는 포크 PR 빌드에 자격 증명을 주지 않습니다

```sh
xenocast token --ci --revoke <ses_id>
```

예전 `api-key` 입력과 `XENOCI_API_KEY`는 종료되어 즉시 실패합니다
토큰 원문은 빌드 스크립트, 대화, 저장소에 쓰지 않습니다

</details>

<details>
<summary>GitLab과 다른 CI에서 CLI로 빌드하기</summary>

비밀 변수 `XENOCAST_TOKEN`을 등록하고 CLI를 설치한 러너에서 실행합니다

```sh
xenocast build --script ./ci.sh
```

GitLab, Jenkins, CircleCI, Buildkite, Bitrise, Azure Pipelines의 시크릿 등록과 설치 절차는 [셋업 안내](https://raw.githubusercontent.com/Xeno-CI/xenocast/main/SETUP.md)를 따르세요
CLI는 CI 토큰을 자격 저장소에 쓰지 않으며 PR 번호와 커밋은 CI 환경 변수에서 자동으로 가져옵니다

</details>

<details>
<summary>MCP와 자주 쓰는 CLI 명령</summary>

로컬 AI 연결은 `xenocast setup --no-tui`로 설정하며 MCP 구성에는 토큰을 넣지 않습니다
도구는 `build`, `status`, `cancel`, `logs`, `macs` 다섯 개입니다

| 할 일 | 명령 |
| --- | --- |
| Mac 조회 | `xenocast macs` |
| 상태 확인 | `xenocast status <rb_id>` |
| 로그 읽기 | `xenocast logs <rb_id>` |
| 빌드 취소 | `xenocast cancel <rb_id>` |
| 실패 분석 | `xenocast diagnose <rb_id>` |

[CLI와 MCP 안내](https://github.com/Xeno-CI/xenocast)에서 로컬 개발 흐름을 확인하세요

</details>

<details>
<summary>문제 해결</summary>

| 증상 | 확인할 곳 |
| --- | --- |
| CI 토큰 없음 | 시크릿 이름과 `with.token` 연결 |
| 토큰 교환 실패 | 만료 또는 폐기 여부 확인 후 토큰 재발급 |
| 소스를 가져오지 못함 | `contents: read` 권한과 대상 커밋 |
| 생성한 파일이 빌드에 없음 | 체크아웃 후 파일을 만들고 `source: upload` 사용 |
| 원격 빌드 실패 | 스텝 로그 또는 `xenocast diagnose <rb_id>` |
| 포크 PR에서 잡이 생략됨 | 예제의 정상 동작, 외부 코드에 시크릿 미전달 |

[오류 코드](https://xenoci.com/docs/errors)에서 다음 행동을 확인하세요

</details>

[문서](https://xenoci.com/docs) | [XenoCast CLI](https://github.com/Xeno-CI/xenocast) | [MIT 라이선스](LICENSE)
