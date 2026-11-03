# xenoci

XenoCI 맥 VM 에서 macOS 빌드와 테스트를 돌리는 CLI 예요, AI 에이전트도 이 CLI 를 직접 써요

- 얼리빌드: 푸시하기 전에 로컬 변경을 XenoCI 맥에서 빌드하고 테스트해요, 바뀐 파일만 올라가고 종료 코드가 그대로 돌아와요
- 에이전트 스킬: Claude Code, Codex, OmO 에 명령 목록, 오류 코드와 다음 행동, 얼리빌드 사용법을 담은 스킬 파일을 써 줘요

Node 18 이상이 필요해요

## 세팅하기

1. 콘솔(https://xenoci.com/console)에서 저장소가 있는 GitHub 조직에 XenoCI 앱을 설치해요
2. 콘솔 API 키 화면(https://xenoci.com/console/api-keys)에서 새 키를 만들고, 터미널에서 저장해요(가린 입력에 붙여 넣기, 키는 명령 인자나 AI 대화창에 넣지 않아요)

   ```sh
   npx xenoci auth set-key
   ```

   환경 변수 `XENOCI_API_KEY` 가 있으면 저장된 키보다 우선해요

3. 저장소 폴더에서 얼리빌드 워크플로를 만들어요, `--workflow` 에 지금 쓰는 워크플로 파일, `--job` 에 그 안의 맥 잡 이름을 넣어요

   ```sh
   npx xenoci earlybuild init --workflow .github/workflows/ci.yml --job build --write --contract-version 1
   ```

   만든 `.github/workflows/xenoci-earlybuild.yml` 은 커밋해 GitHub 에 푸시해요

4. AI 에이전트에 스킬 파일을 써요, 설치된 에이전트(Claude Code, Codex, OmO)를 찾아 쓰고 다시 실행해도 같아요

   ```sh
   npx xenoci skill install --agent all
   ```

## 명령

모든 명령은 `--contract-version 1` 을 붙이면 JSON 한 줄과 정해진 종료 코드로 답해요, 전체 명령과 입력은 `npx xenoci schema --contract-version 1` 로 볼 수 있어요

```sh
npx xenoci earlybuild up --repo owner/app --workflow xenoci-earlybuild.yml --request-id <UUID> --contract-version 1
npx xenoci earlybuild run --id <세션 ID> --dir "$PWD" --command "swift test" --request-id <UUID> --contract-version 1
npx xenoci earlybuild ls --contract-version 1
npx xenoci earlybuild down --id <세션 ID> --request-id <UUID> --contract-version 1
```

GitHub Actions 잡, 로그, 캐시, 사용량은 API 키(`XENOCI_API_KEY`)로 이렇게 봐요, 출력은 기본 JSON 이고 `--format table` 이나 `--format yaml` 도 돼요

```sh
npx xenoci jobs list --repo owner/app --conclusion failure --since 7d
npx xenoci jobs logs <잡 ID> --step "Run tests" --search FAILED
npx xenoci jobs stats <잡 ID>
npx xenoci jobs aggregate --group-by workflow,job_name --since 14d
npx xenoci jobs diagnose rightsize
npx xenoci logs search --query 'level:error repo:owner/app' --since 24h
npx xenoci cache list --repo owner/app --format table
npx xenoci stickydisk list --repo owner/app
npx xenoci usage --since 30d --breakdown-by runner_type,repo
npx xenoci runners catalog --format table
```

오류 코드 설명은 https://xenoci.com/errors 에 있어요

## 라이선스

MIT
