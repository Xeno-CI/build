한국어: 현재 저장소의 `HEAD`를 `.git` 없이 압축해 XenoCI에 올리고, 빌드 스크립트(기본 `bash ci.sh`)를 빌린 맥에서 실행한 뒤 끝날 때까지 기다립니다. 종료 코드는 빌드 결과를 따릅니다.

English: Archives the repository `HEAD` (without `.git`), uploads it, runs the build script (default `bash ci.sh`) on your rented Mac and waits. The exit code follows the build.

## 설정 (4단계)

1. 로그인한 컴퓨터에서 `xenocast token --ci --raw`로 CI 토큰(빌드 전용)을 만듭니다(이 컴퓨터에서 직접 빌드할 거라면 `xenocast build`가 더 간단합니다).
2. 토큰을 셸 기록에 남기지 않게 비밀 도구로 `XENOCAST_TOKEN` 환경 변수에 넣습니다. 저장소 파일에 쓰지 마세요.
3. 선택: `XENOCI_BUILD_SCRIPT`(맥에서 실행할 명령, 기본 `bash ci.sh`), `XENOCI_PR`(PR 번호, 숫자만), `XENOCI_PROJECT`, `XENOCI_API_URL`(기본 `https://xenoci.com`).
4. `sh integrations/local/xenoci-build.sh` 또는 `pwsh -File integrations/local/xenoci-build.ps1`.

커밋된 파일만 올라갑니다(`git archive HEAD`). 커밋하지 않은 변경까지 빌드하려면 CLI(`xenoci build --script ./ci.sh`)를 쓰세요.

## 사용하는 API 호출

1. `POST /api/ci/v1/uploads/tar?project=<이름>` — `git archive --format=tar HEAD | gzip` 본문, `Content-Type: application/gzip`. 응답의 `upload_id`를 씁니다. 파일 실행 권한은 tar에 담겨 그대로 갑니다.
2. `POST /api/ci/v1/builds` — `{"upload_id":"up_…","commit":"<HEAD SHA>","script":"bash ci.sh","pr":42}`. `pr`은 정수이며 `XENOCI_PR`이 없으면 생략합니다.
3. `GET /api/ci/v1/builds/<id>/wait?timeout=60` — 끝날 때까지(`succeeded`·`failed`·`cancelled`·`expired`) 반복. 실패면 `failure.summary`를 출력하고 빌드 종료 코드로 끝납니다.

`XENOCAST_TOKEN`을 `POST /session/refresh`에서 접근 토큰으로 바꾼 뒤 모든 요청: `Authorization: Bearer <접근 토큰>`, `XenoCI-Error-Format: 2`.

## Makefile 예시

```make
.PHONY: xenoci-build
xenoci-build:
	sh integrations/local/xenoci-build.sh
```

## Git pre-push 훅 예시

`.git/hooks/pre-push`에 저장하고 실행 권한을 줍니다.

```sh
#!/bin/sh
exec sh "$(git rev-parse --show-toplevel)/integrations/local/xenoci-build.sh"
```

훅은 현재 `HEAD`를 빌드하므로 푸시 대상과 `HEAD`가 다르면 쓰지 마세요.

