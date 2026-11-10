# 0009. Tauri shell 모듈 경계

## 상태

채택.

## 배경

Tauri shell은 launcher 창, 메뉴바, API sidecar, 단일 실행, 로그인 자동 시작을 함께 조정합니다. 이 책임이 `src-tauri/src/lib.rs` 한 파일에 모이면 서로 다른 수명주기와 실패 흐름이 결합되고 변경 범위를 판단하기 어렵습니다.

Docker·Compose·VM 비즈니스 규칙은 TypeScript 서버가 소유하므로 Tauri shell에서 같은 도메인 계층을 다시 만들지 않습니다. `process`, `system` 같은 범용 기술 폴더도 서로 다른 변경 이유를 숨기므로 사용하지 않습니다.

## 결정

Tauri shell을 앱 기능과 수명주기 기준으로 나눕니다.

- `lib.rs`: crate 공개 진입점 `run`만 제공합니다.
- `app.rs`: Tauri Builder 구성과 최상위 이벤트를 조정합니다.
- `sidecar.rs`: `overseer-server` 자식 프로세스와 JSON Lines 요청·응답을 소유합니다.
- `window.rs`: launcher WebView, Dock과 activation policy를 소유합니다. `window/navigation.rs`는 macOS 앱 내부의 보조 마우스 입력과 화면 이동 전달을 소유합니다.
- `single_instance.rs`: `app.sock`, 재실행 명령과 프로세스 리스너를 소유합니다.
- `autostart.rs`: 로그인 자동 시작과 이전 Helper 항목 정리를 소유합니다.
- `updates.rs`: 서명된 앱 업데이트 확인·설치, 작업 잠금과 설치 후 재실행을 소유합니다.
- `tray/`: 메뉴바 상태 모델, 메뉴, macOS 상태점과 갱신 흐름을 소유합니다.

```text
lib → app
app → sidecar, window, single_instance, autostart, tray, updates
updates → sidecar
tray → sidecar, window
single_instance → window
```

역방향 의존과 순환 의존은 허용하지 않습니다. 각 모듈은 필요한 항목만 `pub(crate)` 또는 `pub(super)`로 노출하며 범용 `utils`, `system`, `process` 모듈을 만들지 않습니다.

## 호환 경계

- `overseer_lib::run()` 공개 진입점을 유지합니다.
- Tauri command `api_request`의 이름과 요청·응답 형식을 유지합니다.
- 메뉴 ID, `app.sock` 명령, `--background`, `--route` 형식을 유지합니다.
- `Cmd+Q`, 재실행, 메뉴바 종료와 sidecar 정리 동작은 0008 결정을 따릅니다.
- 트레이 이미지는 파일 위치와 무관하게 `CARGO_MANIFEST_DIR` 기준으로 포함합니다.
- sidecar 실행 파일은 릴리즈에서 앱 번들만 탐색합니다. `CARGO_MANIFEST_DIR`를 사용하는 개발 경로 fallback은 debug 빌드에만 포함해 빌드 머신 경로가 배포 바이너리에 남지 않도록 합니다.

## 검증

- 단위 테스트는 정책을 소유한 Rust 모듈 가까이에 둡니다.
- `cargo fmt --check`와 `cargo test`로 모듈 경계와 순수 정책을 검증합니다.
- `pnpm check`와 `pnpm tauri:build`로 TypeScript 계약과 패키징 호환성을 검증합니다.
- 설치본에서 백그라운드 시작, 창 열기·닫기, 단일 실행, 메뉴바와 sidecar 수명주기를 확인합니다.
