# 0008. macOS 백그라운드 앱 생명주기

## 상태

채택.

## 결정

- launcher, 메뉴바, Helper로 분리했던 실행 경로를 하나의 Tauri 애플리케이션 프로세스로 통합합니다.
- Tauri 프로세스가 메뉴바, API sidecar, Docker 작업과 launcher 창의 생명주기를 함께 소유합니다.
- 앱을 직접 실행하면 launcher 창과 Dock 아이콘을 표시합니다. 로그인 자동 시작의 `--background` 실행만 창과 Dock 아이콘을 숨깁니다.
- 앱 시작과 메뉴바 상태 조회는 VM을 자동 시작하지 않습니다. 중지된 VM은 사용자가 **VM 시작**을 선택할 때 시작하며, 로그인 시 앱 자동 실행 설정과 VM 시작은 별개입니다.
- 메뉴바의 **Overseer 열기**, Compose·컨테이너 상세 메뉴, 실행 중인 앱의 재실행과 Dock 아이콘 재열기는 launcher 창을 표시합니다.
- launcher 창을 닫거나 `Cmd+Q`를 누르면 창과 Dock 아이콘만 숨기고 백그라운드 프로세스는 유지합니다.
- 메뉴바의 **Overseer 종료**만 Tauri 프로세스와 API sidecar를 완전히 종료합니다.

## 상태 전이

```text
앱 직접 실행
→ 메뉴바 + API sidecar 실행
→ launcher 표시 + Dock 표시

로그인 자동 시작 (--background)
→ 메뉴바 + API sidecar 실행
→ launcher 숨김 + Dock 숨김

메뉴바 열기 또는 앱 재실행
→ Dock 표시 + launcher 표시 및 포커스

창 닫기 또는 Cmd+Q
→ launcher 숨김 + Dock 숨김
→ 메뉴바 + API sidecar 유지

메뉴바 Overseer 종료
→ Tauri 종료
→ API sidecar 종료
```

## 시작 준비와 메뉴

- Homebrew·Docker CLI·Lima 미설치나 Docker Engine 미생성·복구 필요 상태에서는 시작 준비를 안내합니다. 도구 셋업은 대시보드 조회 성공에 의존하지 않습니다.
- 설정된 VM의 단순 중지는 셋업 실패가 아닙니다. 로그인 후 VM은 사용자가 메뉴의 **VM 시작**을 선택할 때 시작합니다.
- Compose와 QEMU 미설치는 필수 셋업 진입 사유가 아닙니다.
- 셋업 필요·상태 확인 중·조회 실패 시 메뉴는 **Overseer 열기**, **Overseer 종료**만 표시합니다. 상태를 확인하면 VM·Compose 메뉴로 전환합니다.
- Homebrew는 기존 공식 Terminal 설치 안내를 제공합니다. 로그인 자동 시작 등록 실패는 앱 진입을 중단하지 않습니다.
- 자동·수동 검증 범위는 [macOS 실행·셋업 검증](../testing/macos-lifecycle.md)을 따릅니다.

## 단일 실행 경계

- `app.sock`은 실행 중인 Tauri 프로세스를 식별하고 재실행 요청을 기존 프로세스에 전달합니다.
- 일반 재실행은 `show` 요청을 보내며, 로그인 자동 시작의 `--background` 실행은 기존 프로세스를 표시하지 않습니다.
- WebView의 API 요청은 별도 Helper 소켓을 거치지 않고 Tauri가 소유한 API sidecar 상태로 직접 전달합니다.
- 이전 `OverseerHelper` 로그인 항목은 새 자동 시작 설정을 등록할 때 제거합니다.

## 실패 흐름

```text
두 번째 앱 실행
→ app.sock 연결 성공: 기존 프로세스가 창을 표시하고 새 프로세스는 종료
→ app.sock 연결 실패: 새 프로세스가 소켓을 선점하고 백그라운드 서비스를 시작

창 표시 실패
→ 메뉴바와 API sidecar는 유지
→ 오류를 표준 오류 출력에 기록

명시적 전체 종료
→ app.sock 제거
→ Tauri 상태 해제로 API sidecar 종료
```

## 호환 경계

- 앱 업데이트 설치 성공은 전체 종료의 추가 진입점입니다. 설치 중 일반 종료를 막으며, 성공 시 sidecar와 소켓을 정리한 뒤 LaunchServices로 새 앱을 엽니다. `--background`를 상속하지 않고 창을 표시합니다. 실패하면 작업 잠금을 해제하고 기존 앱에서 재시도합니다.

- 프런트엔드 경로, Tauri command 이름과 API 요청·응답 계약은 유지합니다.
- Bun API sidecar는 별도 실행 파일로 유지하지만 Tauri 프로세스가 시작과 종료를 소유합니다.
- 로그인 자동 시작은 `Overseer` 실행 파일에 `--background`를 전달합니다.
- 이전 Helper 앱 번들과 `helper.sock`, `launcher.sock` 실행 경로는 더 이상 생성하지 않습니다.
