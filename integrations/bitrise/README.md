# XenoCI for Bitrise

Bitrise의 Git Clone 단계가 받은 커밋을 XenoCI에 올리고, 빌드 스크립트(기본 `bash ci.sh`)를 빌린 맥에서 실행한 뒤 결과를 기다립니다. 비공개 저장소도 추가 설정 없이 됩니다. 실패하면 실패 요약을 출력하고 Bitrise 빌드를 실패 처리합니다.

## 설정 (한국어)

1. 로그인한 컴퓨터에서 `xenocast token --ci --raw`로 CI 토큰(빌드 전용)을 만듭니다.
2. Bitrise 앱 **Secrets**에 `XENOCAST_TOKEN`으로 추가합니다(포크 PR에는 노출하지 않음). 토큰을 `bitrise.yml`에 넣지 마세요. 예전 `XENO_API_KEY`는 종료되었습니다
3. `integrations/bitrise/bitrise.yml`의 `xenoci` 워크플로를 쓰되 그 앞에 **Git Clone** 단계를 둡니다. `run.sh`는 저장소의 `integrations/bitrise/run.sh`에 둡니다.
4. 선택: `XENO_BUILD_SCRIPT`(맥에서 실행할 명령, 기본 `bash ci.sh`, 예 `xcodebuild -scheme App test`), `XENO_API_BASE_URL`(기본 `https://xenoci.com/api/ci/v1`).

## Setup (English)

1. On a logged-in computer run `xenocast token --ci --raw` (a build-only CI token); add it to the app's **Secrets** as `XENOCAST_TOKEN` (not exposed to fork PRs). `XENO_API_KEY` is retired.
2. Use the `xenoci` workflow after a **Git Clone** step. Optional: `XENO_BUILD_SCRIPT` (default `bash ci.sh`), `XENO_API_BASE_URL`.

## API calls

1. `POST /uploads/tar?project=<app>` — `git archive HEAD | gzip` from `BITRISE_SOURCE_DIR`.
2. `POST /builds` — `{"script":"bash ci.sh","upload_id":"up_…","commit":"<BITRISE_GIT_COMMIT>","pr":12}`. `pr` is an integer, sent only when `BITRISE_PULL_REQUEST` is a number.
3. `GET /builds/{id}/wait?timeout=60` — repeated until the build ends; failure prints `failure.summary` and exits non-zero.

The script exchanges `XENOCAST_TOKEN` at `POST /session/refresh` for an access token, then all calls use `Authorization: Bearer <access token>`, `XenoCI-Error-Format: 2`. No token is printed.

