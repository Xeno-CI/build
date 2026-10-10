# XenoCI for CircleCI

CircleCI 작업이 체크아웃한 커밋을 XenoCI에 올리고, 빌드 스크립트(기본 `bash ci.sh`)를 빌린 맥에서 실행한 뒤 결과를 기다립니다. 비공개 저장소도 추가 설정 없이 됩니다(소스를 올리므로).

Your CircleCI job uploads the commit it checked out, runs the build script (default `bash ci.sh`) on your rented Mac and waits for the result. Private repositories need nothing extra because the source is uploaded.

## Setup

1. On a logged-in computer run `xenocast token --ci --raw` to make a build-only CI token.
2. In CircleCI, add the project environment variable `XENOCAST_TOKEN` (keep "Pass secrets to builds from forked pull requests" off). `XENO_API_KEY` is retired. Optional: `XENO_BUILD_SCRIPT` (command run on the Mac, default `bash ci.sh`), `XENO_API_BASE_URL` (default `https://xenoci.com/api/ci/v1`).
3. Copy `integrations/circleci/.circleci/config.yml` to `.circleci/config.yml` and `integrations/circleci/run.sh` to the same path in your repository. The job image needs `curl`, `jq`, `git` and `gzip` (`cimg/base` has them).

## API calls

The script exchanges `XENOCAST_TOKEN` at `POST /session/refresh` for an access token; requests use `Authorization: Bearer <access token>` and `XenoCI-Error-Format: 2`. No token is printed.

1. `POST /uploads/tar?project=<CIRCLE_PROJECT_REPONAME>` with `git archive HEAD | gzip`.
2. `POST /builds` with `{"script":"bash ci.sh","upload_id":"up_…","commit":"<CIRCLE_SHA1>","queue_until_rental":true,"pr":123}`. `CIRCLE_PULL_REQUEST` is a URL; the number after the last `/` is sent as the integer `pr` (omitted when there is none). `queue_until_rental` lets the build wait for a Mac that is being prepared.
3. `GET /builds/{id}/wait?timeout=60`, repeated until the build ends. Success exits 0; otherwise the failure summary is printed and the job fails.

