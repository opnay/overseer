# Overseer

Lima의 공식 Docker 템플릿으로 만든 전용 VM을 브라우저에서 관리하는 로컬 컨트롤 패널입니다. 호스트에는 이미 설치된 `lima`, `docker` CLI만 사용하며, 전역 Docker context를 변경하지 않습니다.

## 요구 사항

- macOS
- Lima 2.0 이상
- Docker CLI와 Compose 플러그인
- Node.js 24 이상
- pnpm 11

City DS는 `opnay/city-ds`의 `1dd3d58772831fb70562d88c752805a3b9d1ee59`에서 빌드한 패키지를 `vendor/opnay-city-ds-react-0.1.0-1dd3d58.tgz`로 고정합니다.

## 시작

```bash
pnpm install
pnpm dev
```

기본 주소는 `http://overseer.localhost:1355`입니다. Portless가 실제 앱에 비어 있는 포트를 자동 배정합니다. Portless를 통하지 않으려면 `pnpm dev:direct`를 사용하십시오.

리소스는 독립 URL에서 관리합니다.

- `/compose`: 실행 이력 또는 raw HTTPS URL 프로젝트, 업데이트 확인·적용, 실행·중지·재시작·로그·내리기
- `/containers`: 확장 설정으로 실행·수정, 시작·중지·재시작·로그·삭제
- `/images`: pull·삭제
- `/volumes`: 생성·삭제
- `/networks`: 생성·삭제, 기본 네트워크 보호

첫 화면에서 **Lima 환경 만들기**를 실행하면 `overseer` 인스턴스를 공식 `template:docker`로 생성합니다. Docker CLI에서 같은 런타임을 사용하려면 다음 환경 변수를 설정하십시오.

```bash
export DOCKER_HOST="$(limactl list overseer --format 'unix://{{.Dir}}/sock/docker.sock')"
docker ps
```

## 검증

```bash
pnpm check
```

## 컨테이너 설정

컨테이너 실행 시 복수 포트, 환경 변수, 명령 인수, named volume, 네트워크, 재시작 정책, CPU·메모리, hostname과 label을 지정할 수 있습니다. 자동 호스트 포트는 `127.0.0.1`에만 바인딩합니다.

이름·재시작 정책·CPU·메모리는 Docker에서 직접 수정합니다. 그 밖의 설정은 Overseer가 만든 컨테이너에 한해 기존 컨테이너를 임시 보존하고 교체하며, 새 컨테이너 생성이나 시작에 실패하면 기존 이름과 실행 상태를 복구합니다. Compose나 외부에서 만든 컨테이너는 알 수 없는 설정의 손실을 막기 위해 교체하지 않습니다.

## 비동기 작업

모든 생성·수정·동작·삭제 요청은 `202 Accepted`와 작업 ID를 즉시 반환합니다. 상단의 **작업** Drawer에서 `queued`, `running`, `succeeded`, `failed`, `cancelled` 상태와 최근 Docker 출력을 확인할 수 있고, 대기 중인 작업만 취소할 수 있습니다. 작업 기록은 현재 서버 프로세스에서 최근 100개를 유지하며 서버 재시작 시 초기화됩니다.

- `GET /api/operations`: 최근 작업 목록
- `GET /api/operations/:id`: 단일 작업 상태
- `DELETE /api/operations/:id`: 대기 작업 취소
- `GET /api/containers/:id`: 수정용 설정과 config hash
- `PATCH /api/containers/:id`: config hash 기반 수정 작업 접수

## URL Compose

Compose 페이지에서 GitHub Raw처럼 인증 없이 파일 내용이 열리는 공개 HTTPS `compose.yaml` URL을 등록할 수 있습니다. 원본 URL과 현재·대기 중인 파일, ETag·Last-Modified, content hash와 업데이트 확인 결과는 `~/Library/Application Support/Overseer/overseer.sqlite`에 저장하며 materialized 파일은 같은 디렉터리의 `compose/<project>/compose.yaml`에 둡니다. `OVERSEER_DATA_DIR`과 `OVERSEER_DATABASE_PATH`로 위치를 바꿀 수 있습니다.

- URL 등록은 비동기 작업이며 Docker Compose JSON config로 검증합니다.
- **업데이트 확인**은 조건부 HTTP 요청과 content hash를 사용하고, 변경된 파일은 사용자가 **업데이트 적용**을 실행할 때 현재 파일이 됩니다.
- URL Compose는 Lima 내부의 전용 작업 디렉터리에서 실행하므로 `./data` 같은 상대 bind mount는 VM 디스크에 유지됩니다.
- `build.context`가 포함된 파일도 등록·업데이트할 수 있지만 로컬 소스가 없으므로 **Compose 적용**은 명시적으로 실패합니다.
- 인증 정보가 없는 HTTPS만 허용하며 리다이렉트마다 DNS를 확인해 loopback·사설·link-local 주소를 거부합니다.
- 응답 시간은 15초, 리다이렉트는 3회, 파일 크기는 1MiB로 제한합니다.
- 실행 중인 URL 프로젝트는 먼저 내려야 등록을 해제할 수 있습니다.

## 안전 경계

- 서버는 `127.0.0.1`에만 바인딩합니다.
- 컨테이너 포트는 기본적으로 `127.0.0.1`의 빈 포트에 게시합니다.
- 컨테이너 설정은 named volume만 연결하며 bind mount, privileged, device와 host network를 노출하지 않습니다.
- 브라우저 요청으로 임의 셸 명령을 실행할 수 없습니다.
- URL Compose fetch는 공개 HTTPS와 1MiB 이하 raw 문서로 제한합니다.
- Compose 작업은 Docker가 보고한 프로젝트명과 구성 파일만 사용합니다.
- Compose 프로젝트 내리기는 named volume과 구성 파일을 삭제하지 않습니다.
- 전역 Docker context와 `/var/run/docker.sock`을 변경하지 않습니다.
- 컨테이너·이미지 삭제에는 명시적인 확인이 필요합니다.
