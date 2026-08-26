# 0006. 클라이언트 FSD-lite 3개 레이어

## 상태

채택.

## 결정

- `src/client`는 `app`, `pages`, `shared` 3개 레이어만 사용합니다.
- `app`은 엔트리포인트, 전역 스타일, 라우팅 조합과 애플리케이션 셸을 소유합니다.
- `pages`는 Compose, 컨테이너, 이미지, 인스턴스, 네트워크, 작업, 설정, 시작 준비, 볼륨 slice로 나눕니다. 유사한 목록·상세 화면과 전용 Dialog는 같은 slice에 둡니다.
- `shared`는 API 클라이언트, 전역 라우트, 날짜처럼 목적이 한정된 라이브러리와 비즈니스 상태를 소유하지 않는 공용 UI만 포함합니다.
- 서버와 클라이언트가 함께 사용하는 `src/shared` 계약은 FSD 레이어 밖의 전송 계약 원본으로 유지하고 `@contracts` alias로 참조합니다.
- `features`, `entities`, `widgets`는 현재 만들지 않습니다. 여러 page slice에서 같은 사용자 행위·도메인 표현·독립 UI 블록이 재사용될 때만 추가합니다.

## 의존 규칙

1. 의존 방향은 `app → pages → shared`만 허용합니다.
2. 같은 `pages` 레이어의 slice끼리는 직접 import하지 않습니다.
3. 다른 slice나 shared module은 `index.ts` public API로만 접근합니다. slice 내부는 전체 상대 경로를 사용합니다.
4. `tests/client-architecture.test.ts`가 alias import와 레이어 경계를 검증합니다.

## 호환 경계

- URL, API 요청·응답, 작업 기록, Tauri sidecar와 서버 계약은 변경하지 않습니다.
- 구조 이전과 제품 동작 변경을 같은 작업에 섞지 않습니다.
- `app/styles/app.css`는 기존 전역 스타일을 그대로 보존합니다. 화면별 스타일 분리는 소유권과 회귀 범위를 별도로 검증할 수 있을 때 진행합니다.
