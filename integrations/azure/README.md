# Azure Pipelines용 XenoCI

Azure Pipelines가 체크아웃한 커밋을 XenoCI에 올리고, 빌드 스크립트(기본 `bash ci.sh`)를 빌린 맥에서 실행한 뒤 끝날 때까지 기다립니다. Azure Repos 비공개 저장소도 추가 설정 없이 됩니다(소스를 올리므로). PR 빌드에서는 `System.PullRequest.PullRequestNumber`를 정수 `pr`로 보냅니다.

Uploads the commit Azure Pipelines checked out, runs the build script (default `bash ci.sh`) on your rented Mac and waits. Private repositories work because the source is uploaded. PR builds send `System.PullRequest.PullRequestNumber` as the integer `pr`.

## 설정 (3단계)

1. 로그인한 컴퓨터에서 `xenocast token --ci --raw`로 CI 토큰(빌드 전용)을 만듭니다.
2. **Pipelines → Library → Variable groups**에 `XENOCAST_TOKEN`을 비밀로 추가합니다(포크 PR 빌드에 비밀을 주지 않음).
3. `azure-pipelines.yml`을 저장소 루트에, `run.sh`를 `integrations/azure/run.sh`에 둡니다. 선택 변수: `XENOCI_BUILD_SCRIPT`(기본 `bash ci.sh`), `XENOCI_API_URL`(기본 `https://xenoci.com`).

## 사용하는 API 호출 / API calls

기본 주소 `https://xenoci.com/api/ci/v1`. 스크립트가 `XENOCAST_TOKEN`을 `POST /session/refresh`에서 접근 토큰으로 바꾼 뒤 모든 요청에 `Authorization: Bearer <접근 토큰>`을 씁니다. 토큰은 출력하지 않습니다.

1. `POST /uploads/tar?project=<Build.Repository.Name>` — `git archive HEAD | gzip` from `Build.SourcesDirectory`.
2. `POST /builds` — `{"upload_id":"up_…","commit":"<Build.SourceVersion>","script":"bash ci.sh","pr":17}`.
3. `GET /builds/{id}/wait?timeout=60` — 끝날 때까지 반복. `failed`·`cancelled`·`expired`면 `failure.summary`를 출력하고 실패합니다.

