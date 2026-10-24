# XenoCI 스티키 디스크

`runs-on: xenoci-macos` 잡에서 의존성, 빌드 결과처럼 매번 다시 받기 무거운 폴더를 다음 잡까지 남깁니다

```yaml
jobs:
  build:
    runs-on: xenoci-macos
    steps:
      - uses: actions/checkout@v4
      - uses: Xeno-CI/build/stickydisk@v1.7.13
        with:
          key: derived-data
          path: ~/Library/Developer/Xcode/DerivedData
      - run: xcodebuild -scheme App build
```

- `key`: 저장소 안에서 디스크를 구분하는 이름, 같은 저장소의 같은 key 는 같은 디스크입니다
- `path`: 디스크를 붙일 빈 경로입니다
- 잡이 성공하면 끝날 때 디스크를 저장하고, 다음 잡이 같은 key 로 이어 씁니다
- 기본 브랜치 보호가 걸린 잡이나 신뢰하지 않는 잡(포크 PR 등)은 읽기만 하고 저장하지 않습니다
- 디스크를 붙이지 못하면(서비스에 자리가 없을 때 등) 단계는 실패하지 않고 디스크 없이 빈 폴더로 이어 가며 로그에 이유를 한 줄 남깁니다
- 요금과 삭제 규칙은 [요금](https://xenoci.com/pricing)과 [이용약관](https://xenoci.com/terms) 제4조의2를 따릅니다
- XenoCI 러너(`runs-on: xenoci-macos`)에서만 동작합니다
