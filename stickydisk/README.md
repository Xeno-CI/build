# XenoCI 스티키 디스크

XenoCI Linux와 Mac 러너에서 폴더를 다음 잡까지 보관합니다. 스티키 디스크와 캐시는 러너에 포함되며 별도 저장 요금이 없습니다.

## Linux

```yaml
jobs:
  build:
    runs-on: xenoci-2vcpu-ubuntu-2404
    steps:
      - uses: actions/checkout@v4
      - uses: Xeno-CI/build/stickydisk@stickydisk-v1.0.1
        with:
          key: npm-cache
          path: ~/.npm
      - run: npm ci
```

## Mac

```yaml
jobs:
  build:
    runs-on: xenoci-standard
    steps:
      - uses: actions/checkout@v4
      - uses: Xeno-CI/build/stickydisk@stickydisk-v1.0.1
        with:
          key: derived-data
          path: ~/Library/Developer/Xcode/DerivedData
      - run: xcodebuild -scheme App build
```

- `key`는 저장소 안에서 디스크를 구분합니다. 다른 조직이나 저장소의 같은 키와는 섞이지 않습니다.
- `path`는 없거나 비어 있는 경로여야 합니다. 작업 폴더 기준 상대 경로, 절대 경로, `~/`를 사용할 수 있습니다.
- 각 잡은 별도 디스크 복사본을 사용합니다. 잡이 끝나면 저장하며, 기본 브랜치 보호가 켜진 경우 신뢰된 기본 브랜치 잡만 공유 내용을 갱신합니다. 다른 잡의 변경은 공유 디스크에 반영되지 않습니다.
- Linux는 ext4 블록 디스크를 사용합니다. Mac은 러너가 제공하는 블록 디스크 또는 APFS 아카이브 경로를 사용합니다.
- 연결이나 저장에 실패하면 경고를 남기고 캐시 없이 진행합니다. 잘못된 입력이나 안전한 분리·정리에 실패한 경우는 오류가 될 수 있습니다.
- 7일 동안 쓰지 않은 디스크는 자동 정리됩니다. 콘솔의 스티키 디스크 화면에서 크기·마지막 사용을 확인하고 삭제할 수 있습니다. 잡이 사용 중이면 삭제하지 않습니다.
- Actions 캐시의 저장소당 25GB 상한은 별도 `actions/cache` 저장소에 적용됩니다. 스티키 디스크 공간은 XenoCI가 관리하며 공간 부족 시 캐시 없이 실행합니다.
- XenoCI 러너가 발급한 잡 권한으로만 동작합니다. GitHub 호스티드 러너에서는 사용할 수 없습니다.

기존 `v1.7.13` 태그는 그대로 유지됩니다. 이 릴리스는 CLI나 다른 액션을 변경하지 않습니다.

`stickydisk-v1.0.1`은 Linux에서 Actions 캐시의 NAS 주소를 스티키 권한 요청에 잘못 사용하던 문제를 수정합니다. 기존 `stickydisk-v1.0.0` 태그도 이동하지 않습니다.
