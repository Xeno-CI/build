# Azure Pipelines용 XenoCast (부가 기능)

`azure-pipelines.yml`이 CLI를 설치하고 `run.sh`가 체크아웃된 폴더를 `xenocast build`로 XenoCI macOS VM에서 빌드합니다. 종료 코드는 원격 잡의 종료 코드이며 취소 신호는 원격 잡 취소로 이어집니다

1. 콘솔 https://xenoci.com/console 에서 발급한 API 키(`xci_live_…`)를 CI 비밀 변수 `XENOCI_API_KEY`에 넣습니다. YAML이나 대화에 키를 쓰지 않습니다
2. `azure-pipelines.yml`과 `integrations/azure/run.sh`를 저장소에 둡니다
3. 선택 변수: `XENOCI_BUILD_SCRIPT`(기본 `bash ci.sh`), `XENOCI_API_URL`(origin, 기본 `https://xenoci.com`)

CLI가 키를 `Authorization: Bearer`로 `/api/runner/v1`에 보냅니다. 자격 파일과 기기 키는 업로드에서 제외됩니다

설정: https://github.com/Xeno-CI/xenocast/blob/main/SETUP.md
