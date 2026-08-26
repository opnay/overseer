# 0007. 서버 도메인 모듈형 모놀리스

## 상태

채택.

## 결정

- `src/server`는 하나의 프로세스와 배포 단위를 유지하는 도메인 모듈형 모놀리스로 구성합니다.
- 최상위 경계는 `app`, `application`, `core`, `infrastructure`, `modules`로 제한합니다.
- `app`은 Hono 조립, HTTP 라우트, 미들웨어와 오류 응답을 소유합니다.
- `application`은 서버가 제공하는 유스케이스 포트를 정의하며 외부 구현을 알지 못합니다.
- `modules`는 Compose, 컨테이너, Docker Engine, 이미지, 인스턴스, 네트워크, 작업, 시작 준비, 볼륨 단위로 정책·검증·서비스·저장을 소유합니다.
- `infrastructure`는 Lima, 프로세스, SQLite와 데스크톱 브리지처럼 외부 시스템에 접속하는 구현을 소유합니다.
- `core`는 오류와 JSON Lines 파싱처럼 특정 모듈에 귀속되지 않는 작은 서버 공통 계약만 소유합니다.

## 실행 흐름

```text
HTTP route
→ application controller port
→ domain module service
→ Lima / Docker / SQLite / process adapter
```

`LimaDockerRuntime`은 애플리케이션 포트를 구현하는 인프라 어댑터입니다. VM과 Docker Engine 생명주기를 소유하며 컨테이너·Compose·이미지·볼륨·네트워크 동작은 각 모듈 서비스에 위임합니다.

## 실패 흐름

```text
external command or storage failure
→ adapter preserves diagnostic context
→ ExpectedError or operation failure
→ OperationQueue persists output and state
→ HTTP error mapper returns the stable client contract
```

자동 복구, 재시도, 잠금과 작업 출력은 기존 계약을 유지하며 구조 리팩터링에서 의미를 변경하지 않습니다.

## 의존 규칙

1. `core`는 상위 서버 경계를 import하지 않습니다.
2. `application`은 `app`과 `infrastructure`를 import하지 않습니다.
3. `modules`는 `app`과 `application`을 import하지 않습니다.
4. 다른 도메인 모듈이나 인프라에서 모듈을 사용할 때는 해당 모듈의 `index.ts` 공개 API로만 접근합니다.
5. `src/server` 루트에는 `start.ts`, `dev.ts`, `desktop-sidecar.ts` 실행 진입점만 둡니다.
6. `tests/server-architecture.test.ts`가 경계와 공개 API 접근을 검증합니다.

## 호환 경계

- HTTP 경로, 요청·응답 DTO와 상태 코드는 변경하지 않습니다.
- SQLite 파일과 테이블, 작업 기록, Lima 인스턴스와 Docker context 계약은 변경하지 않습니다.
- Tauri sidecar 엔트리포인트와 독립 서버 실행 명령은 유지합니다.
- 별도 서비스 분리, CQRS, 이벤트 버스와 범용 repository 계층은 현재 도입하지 않습니다.
