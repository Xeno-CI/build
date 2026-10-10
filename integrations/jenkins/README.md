# Jenkins

한국어: Jenkins가 체크아웃한 커밋을 XenoCI에 올리고, 빌드 스크립트(기본 `bash ci.sh`)를 빌린 맥에서 실행하며 로그를 따라가다 빌드 결과로 끝납니다. 멀티브랜치 PR이면 `CHANGE_ID`를 PR 번호로 함께 보냅니다.

English: Uploads the commit Jenkins checked out, runs the build script (default `bash ci.sh`) on your rented Mac, streams the log and ends with the build result. Multibranch PR builds send `CHANGE_ID` as the PR number.

## 설정 / Setup

1. Jenkins **Secret text** credential, ID `XENOCAST_TOKEN` (a build-only CI token from `xenocast token --ci --raw`). Do not give credentials to fork pull request builds (GitHub Branch Source "Trust": Nobody or Collaborators).
2. Use `integrations/jenkins/Jenkinsfile` as the pipeline script (copy `xenoci-build.sh` to the same path in your repository).
3. Agent needs `bash`, `curl`, `node`, `git`, `gzip` and a git checkout of the job.
4. Optional environment: `XENOCI_BUILD_SCRIPT` (command run on the Mac, default `bash ci.sh`), `XENOCI_API_URL` (default `https://xenoci.com/api/ci/v1`).

Jenkins abort stops the step; the remote build keeps running until its timeout unless you use the CLI (`xenoci build`, which cancels on SIGTERM). The CLI is the shortest Jenkins setup: see https://github.com/Xeno-CI/build (REST/curl only: https://xenoci.com/agent-start.md).

## API calls

```http
POST /api/ci/v1/uploads/tar?project=<repo>        (git archive HEAD | gzip, Content-Type: application/gzip)
POST /api/ci/v1/builds                             {"script":"bash ci.sh","upload_id":"up_…","commit":"<GIT_COMMIT>","pr":<CHANGE_ID>}
GET  /api/ci/v1/builds/<id>/log?format=text&offset=<n>&wait=20   (repeat; X-Next-Offset, X-Build-State, X-Exit-Code)
```

`pr` is an integer and is sent only when `CHANGE_ID` is a number. The script exchanges `XENOCAST_TOKEN` at `POST /session/refresh` for an access token and uses it as `Authorization: Bearer`; no token is printed.

