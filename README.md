# Overseer

Lima의 공식 Docker 템플릿으로 만든 전용 VM을 Docker Desktop처럼 macOS Docker CLI와 브라우저에서 함께 관리하는 로컬 컨트롤 패널입니다. 첫 실행에서 Homebrew·Docker CLI와 Compose·Lima·Docker Engine을 준비하고 기본 Docker context를 `overseer`로 연결합니다.

## 요구 사항

- macOS
- Homebrew
- Lima 2.0 이상
- Docker CLI
- Docker Compose 플러그인(Compose 기능 사용 시 선택)
- Node.js 24 이상
- pnpm 11

QEMU VM 드라이버를 사용하려면 QEMU도 설치하십시오. 기본 VZ 드라이버에는 필요하지 않습니다.

```bash
brew install qemu
```

City DS는 GitHub Packages의 `@opnay/city-ds-react@0.1.1`로 고정합니다. 최초 설치 전 `read:packages` 권한이 있는 GitHub 토큰을 사용자 npm 설정에 등록하십시오.

```bash
gh auth refresh -s read:packages
npm config set //npm.pkg.github.com/:_authToken "$(gh auth token)" --location=user
```

운영 화면의 Table·상태·액션·로그 적용 규칙은 [`docs/decisions/0003-operation-interface-patterns.md`](docs/decisions/0003-operation-interface-patterns.md)를 따릅니다.

## 시작

```bash
pnpm install
pnpm dev
```

기본 주소는 `http://overseer.localhost:1355`입니다. Portless가 실제 앱에 비어 있는 포트를 자동 배정합니다. Portless를 통하지 않으려면 `pnpm dev:direct`를 사용하십시오.

### Tauri macOS 셸

기존 React/Vite 화면을 사용하는 Tauri 2 애플리케이션을 실행하거나 빌드할 수 있습니다.

```bash
pnpm tauri:dev
pnpm tauri:build
```

macOS 앱은 `src-tauri/target/release/bundle/macos/Overseer.app`에 생성되며 내부 `OverseerHelper.app`과 Bun으로 컴파일한 API sidecar를 포함합니다. 로그인 자동 시작되는 Helper가 메뉴바·sidecar·Docker 작업을 소유하고, launcher 창은 Tauri IPC로 같은 API를 사용합니다. 메뉴바에서는 활성 VM을 재시작하고 Compose별 시작·중지·재시작과 컨테이너 목록을 확인할 수 있으며, Compose나 컨테이너를 선택하면 launcher의 해당 상세 화면을 엽니다.

배포 인증서 없이 로컬 설치할 때는 bundle 전체를 ad-hoc 서명한 뒤 `/Applications`로 복사하십시오.

```bash
codesign --force --deep --sign - --timestamp=none src-tauri/target/release/bundle/macos/Overseer.app
ditto src-tauri/target/release/bundle/macos/Overseer.app /Applications/Overseer.app
open -a /Applications/Overseer.app
```

시작 준비 화면은 Homebrew, Docker CLI, Lima, Docker Engine 순서로 안내합니다. Docker Compose는 Docker 단계에서 선택하거나 건너뛸 수 있습니다. 모든 도구 설치 단계는 Terminal용 명령을 복사할 수 있으며 Docker·Compose·Lima는 UI에서 Homebrew 설치 작업을 시작하고 진행 출력도 확인할 수 있습니다. Homebrew는 관리자 인증이 필요하므로 공식 명령을 Terminal에서 직접 실행해야 합니다. 마지막 단계는 전용 Lima VM과 Docker Engine의 준비 상태를 확인하고, 설정이 필요하면 실행 환경·VM 드라이버·자원을 간략한 폼에서 선택해 Engine을 만듭니다. 상태는 시작 화면에서 10초마다 다시 확인합니다. 준비가 감지되면 자동 설치 로그를 접고 일반 구분선 뒤에 **다음**을 표시하며, 사용자가 선택할 때만 다음 단계로 이동합니다.

도구를 제거하지 않고 각 미설치 화면을 확인하려면 `/startup?startup-preview=homebrew`, `/startup?startup-preview=docker`, `/startup?startup-preview=lima`를 사용하십시오. 미리보기는 대상보다 앞선 단계를 완료 상태로 구성하며 실제 도구 감지 결과와 호스트 패키지를 변경하지 않습니다. 다른 페이지에서 필수 설치가 감지되면 `/startup`으로 이동하고, 완료 후 원래 페이지로 돌아갑니다.

도구 준비가 끝나면 **설정 > 일반**에서 Homebrew로 설치된 Docker CLI·Compose·Lima의 업데이트를 한 번에 확인하고, 새 버전이 있는 항목만 개별 업데이트할 수 있습니다. 외부 설치본은 현재 버전과 수동 관리 사유만 표시합니다. 업데이트는 호스트 명령 도구만 교체하며 실행 중인 Lima VM과 컨테이너를 재생성하지 않습니다. **설정 > Docker Engine**의 **엔진 설정**에서 활성 Engine의 daemon 동작을, **네트워크 설정**에서 DNS·주소 풀·Registry·Proxy를 관리합니다. 메인 메뉴의 **가상화 > 인스턴스**에서는 로컬 Lima 인스턴스의 상태·가상화 방식·할당 자원을 확인하고, 행 메뉴에서 사용할 Docker Engine을 선택하거나 새 VM을 만들 수 있습니다. 인스턴스 생성 폼의 실행 환경은 현재 Lima VM으로 고정하며 VM 드라이버는 VZ 또는 QEMU입니다. 기본 VM 값은 VZ, CPU 4개, 메모리 4GiB, 디스크 100GiB이고 QEMU가 설치되지 않았으면 QEMU 옵션을 선택할 수 없습니다.

리소스는 독립 URL에서 관리합니다.

- `/startup`: 설치 완료 후에도 Homebrew·Docker CLI·Compose·Lima·Docker Engine 시작 준비 흐름 확인
- `/compose`, `/compose/:name`: 폼 또는 raw HTTPS URL 프로젝트 등록, 개요·서비스·구성·로그 상세, URL 업데이트와 폼 설정, 실행·중지·재시작·내리기
- `/containers`, `/containers/:id`: 확장 설정으로 실행·수정, 개요·실행 설정·연결·환경 변수·Label 상세, 시작·중지·재시작·로그·삭제
- `/images`, `/images/:id`: pull·삭제, 실행 설정·환경 변수·Label·레이어·원본 Inspect 상세
- `/volumes`, `/volumes/:name`: 생성·삭제, 드라이버·Mountpoint·옵션·Label·원본 Inspect 상세
- `/networks`, `/networks/:name`: 생성·삭제, 기본 네트워크 보호, IPAM·연결 컨테이너·옵션·Label·원본 Inspect 상세
- `/operations`: Overseer에서 요청한 전체 작업 기록·상세 출력·실패 작업 재시도
- `/instances`, `/instances/:name`: Lima VM 생성·선택·시작·중지, VM 설정·Docker 연결·터미널 상세
- `/settings`: Overseer 일반 설정과 활성 Docker Engine의 daemon·네트워크 설정

시작 준비의 **Docker Engine 만들기**는 기본 `overseer` 인스턴스를 생성합니다. 이후 **가상화 > 인스턴스**에서는 이름과 VM 자원을 지정해 추가 Lima 인스턴스를 만들거나, Docker socket forwarding이 구성된 기존 인스턴스를 선택할 수 있습니다. 목록은 상태·가상화 방식·할당 자원을 표시하고, 컨테이너 수·Docker 연결·선택 상태와 터미널 명령은 인스턴스 상세에서 확인합니다. macOS 홈 공유가 읽기 전용인 기존 인스턴스는 **준비** 작업으로 writable mount를 적용합니다. Overseer가 만든 인스턴스 여부와 무관하게 한 번에 하나만 활성 Engine이며 선택값은 호스트 SQLite에 저장됩니다. `OVERSEER_LIMA_INSTANCE`가 있으면 그 인스턴스로 선택이 고정됩니다.

별도 환경 변수 없이 일반 Docker CLI가 같은 런타임을 사용합니다.

```bash
docker context show
docker ps
docker compose version
```

활성 인스턴스를 선택하면 Lima socket을 가리키는 `overseer` Docker context를 생성·갱신합니다. 기존 Lima 홈 공유가 읽기 전용이면 **가상화 > 인스턴스**에서 해당 인스턴스의 **준비**를 실행하십시오. 쓰기 가능 공유로 바꾸는 경우 실행 중인 인스턴스를 한 번 다시 시작합니다.

## 검증

```bash
pnpm check
```

## 클라이언트 구조

`src/client`는 FSD-lite의 `app`, `pages`, `shared` 3개 레이어로 구성합니다. 의존 방향은 `app → pages → shared`만 허용하고, page slice 간 직접 import를 금지하며, 다른 slice와 shared module은 `index.ts` public API로만 접근합니다. `tests/client-architecture.test.ts`가 이 경계를 검증합니다. 서버와 함께 사용하는 `src/shared`는 전송 계약 원본이므로 클라이언트 레이어 밖에 유지합니다.

## 컨테이너 설정

컨테이너 실행 시 복수 포트, 환경 변수, 명령 인수, named volume, 네트워크, 재시작 정책, CPU·메모리, hostname과 label을 지정할 수 있습니다. 자동 호스트 포트는 `127.0.0.1`에만 바인딩합니다.

이름·재시작 정책·CPU·메모리는 Docker에서 직접 수정합니다. 그 밖의 설정은 Overseer가 만든 컨테이너에 한해 기존 컨테이너를 임시 보존하고 교체하며, 새 컨테이너 생성이나 시작에 실패하면 기존 이름과 실행 상태를 복구합니다. Compose나 외부에서 만든 컨테이너는 알 수 없는 설정의 손실을 막기 위해 교체하지 않습니다.

## 비동기 작업

모든 생성·수정·동작·삭제 요청은 `202 Accepted`와 작업 ID를 즉시 반환합니다. 상단의 **작업** Drawer에는 대기·진행·실패 작업만 표시하고, `/operations` 페이지에는 Overseer에서 요청한 모든 작업과 전체 작업 출력을 SQLite에 계속 저장하며 검색·상태·리소스 필터와 페이지 이동을 제공합니다. Drawer의 출력은 6줄 높이에서 스크롤하며 크게 보기에서는 같은 전체 출력을 표시합니다. 서버 재시작 당시 대기·실행 중이던 작업은 중단 실패로 기록하며, 실패 작업은 저장된 원래 요청을 다시 검증해 새 작업으로 재시도할 수 있습니다. Docker CLI에서 직접 실행한 작업은 기록하지 않습니다.

- `GET /api/operations`: 작업 기록. `page`, `pageSize`, `query`, `status`, `resource`로 조회하며 기본 응답은 최근 50개와 pagination 정보를 포함
- `GET /api/operations/:id`: 단일 작업 상태
- `DELETE /api/operations/:id`: 대기 작업 취소
- `POST /api/operations/:id/retry`: 실패 작업을 새 작업으로 재접수
- `GET /api/containers/:id`: 수정용 설정과 config hash
- `GET /api/containers/:id/inspect`: 전체 Docker inspect JSON과 Health Check 이력
- `PATCH /api/containers/:id`: config hash 기반 수정 작업 접수
- `GET /api/images/:id`: 이미지 설정과 전체 Docker inspect JSON
- `GET /api/volumes/:name`: 볼륨 설정과 전체 Docker inspect JSON
- `GET /api/networks/:name`: 네트워크·IPAM·연결 컨테이너와 전체 Docker inspect JSON
- `GET /api/runtime/configuration`: 실제 VM 설정 또는 기본 설정과 드라이버 가용성
- `GET /api/runtime/instances`: 로컬 Lima 인스턴스와 컨테이너 수·호환성·준비·선택 상태
- `POST /api/runtime/instances`: 이름과 VM 설정으로 관리 인스턴스 생성
- `PATCH /api/runtime/instances/:name`: Overseer 관리 인스턴스의 CPU·메모리·디스크 수정
- `DELETE /api/runtime/instances/:name`: 이름 확인 후 Overseer 관리 인스턴스 삭제
- `POST /api/runtime/instances/:name/select`: 준비된 인스턴스를 활성 Engine으로 선택
- `POST /api/runtime/instances/:name/prepare`: writable 홈 공유와 Docker context 준비
- `POST /api/runtime/instances/:name/start`: 선택한 Lima 인스턴스 시작
- `POST /api/runtime/instances/:name/stop`: 선택한 Lima 인스턴스 중지
- `GET /api/runtime/engine/configuration`: rootless Docker daemon 설정과 적용 가능 상태
- `PATCH /api/runtime/engine/configuration`: daemon 설정 검증·적용 및 실패 시 이전 파일 복구 작업 접수
- `PATCH /api/runtime/engine/configuration/:section`: 최신 daemon 설정에 선택 섹션만 병합하는 작업 접수
- `POST /api/runtime/start`: 중지된 VM 시작 또는 선택 설정으로 첫 VM 생성
- `POST /api/runtime/cli/connect`: writable 홈 공유와 `overseer` Docker context 연결 작업 접수
- `POST /api/runtime/recreate`: 확인 문자열과 선택 설정으로 단일 VM 재생성
- `POST /api/runtime/restart`: 활성 VM을 삭제 없이 중지한 뒤 다시 시작
- `GET /api/startup`: Homebrew·Docker CLI와 Compose·Lima 설치 상태
- `POST /api/startup/prerequisites/:id/install`: Docker·Compose·Lima Homebrew 설치 작업 접수
- `GET /api/startup/updates`: Docker CLI·Compose·Lima의 현재·최신 버전과 관리 방식
- `POST /api/startup/updates/check`: Homebrew 저장소 갱신 및 업데이트 확인 작업 접수
- `POST /api/startup/prerequisites/:id/update`: 확인된 Homebrew formula 개별 업데이트 작업 접수

## URL Compose

Compose 페이지에서 GitHub Raw처럼 인증 없이 파일 내용이 열리는 공개 HTTPS `compose.yaml` URL을 등록할 수 있습니다. 원본 URL과 현재·대기 중인 파일, ETag·Last-Modified, content hash와 업데이트 확인 결과는 `~/Library/Application Support/Overseer/overseer.sqlite`에 저장하며 materialized 파일은 같은 디렉터리의 `compose/<project>/compose.yaml`에 둡니다. `OVERSEER_DATA_DIR`과 `OVERSEER_DATABASE_PATH`로 위치를 바꿀 수 있습니다.

- URL 등록은 비동기 작업이며 Docker Compose JSON config로 검증합니다.
- **업데이트 확인**은 조건부 HTTP 요청과 content hash를 사용하고, 변경된 파일은 사용자가 **업데이트 적용**을 실행할 때 현재 파일이 됩니다.
- URL Compose는 macOS Docker CLI에서 materialized 파일을 직접 실행합니다. `./data` 같은 상대 bind mount는 `~/Library/Application Support/Overseer/compose/<project>/data`처럼 Compose 파일 옆의 macOS 경로를 사용합니다.
- `build.context`가 포함된 파일도 등록·업데이트할 수 있지만 로컬 소스가 없으므로 **Compose 적용**은 명시적으로 실패합니다.
- 인증 정보가 없는 HTTPS만 허용하며 리다이렉트마다 DNS를 확인해 loopback·사설·link-local 주소를 거부합니다.
- 응답 시간은 15초, 리다이렉트는 3회, 파일 크기는 1MiB로 제한합니다.
- 실행 중인 URL 프로젝트는 먼저 내려야 등록을 해제할 수 있습니다.

## 폼 Compose

Compose 페이지의 **폼으로 추가**에서 복수 서비스와 image·tag, 명령 인수, 포트, 환경 변수, named volume, network, 재시작 정책을 입력할 수 있습니다. 폼과 **YAML 미리보기** 탭은 같은 생성기를 사용하므로 저장되는 `compose.yaml`을 등록 전에 확인할 수 있습니다.

- 프로젝트 설정과 생성된 YAML은 `builder_compose_projects` SQLite 테이블에 저장합니다.
- 저장된 설정은 수정할 수 있으며 config hash로 오래된 편집 요청을 거부합니다.
- 호스트 포트는 지정하거나 Docker에 자동 배정을 맡길 수 있고, 항상 `127.0.0.1`에만 게시합니다.
- 폼 Compose는 image 기반 서비스만 지원합니다. build context, bind mount, privileged, device와 host network는 생성하지 않습니다.
- 등록은 프로젝트를 실행하지 않습니다. 목록의 **Compose 적용**으로 별도 실행하며, 실행 중인 프로젝트는 먼저 내려야 수정하거나 등록을 해제할 수 있습니다.

## 안전 경계

- 서버는 `127.0.0.1`에만 바인딩합니다.
- 컨테이너 포트는 기본적으로 `127.0.0.1`의 빈 포트에 게시합니다.
- 컨테이너 생성·편집은 named volume만 연결합니다. 상세 화면은 bind mount를 읽기 전용으로 구분하고 전체 호스트 소스 경로를 표시합니다.
- bind mount, privileged, device와 host network 설정은 생성·편집에 노출하지 않습니다.
- 브라우저 요청은 고정된 Homebrew formula 설치·확인·업데이트만 실행하며 임의 셸 명령을 실행할 수 없습니다.
- URL Compose fetch는 공개 HTTPS와 1MiB 이하 raw 문서로 제한합니다.
- Compose 작업은 Docker가 보고한 프로젝트명과 구성 파일만 사용합니다.
- Compose 프로젝트 내리기는 named volume과 구성 파일을 삭제하지 않습니다.
- `overseer` Docker context를 생성·갱신하고 기본 context로 선택합니다. `/var/run/docker.sock`은 변경하지 않습니다.
- Docker Desktop과 같은 로컬 bind mount 동작을 위해 macOS 홈 디렉터리를 Lima에 쓰기 가능하게 공유합니다. 컨테이너에 bind mount한 경로는 컨테이너 프로세스에서도 쓸 수 있으므로 신뢰하는 Compose 파일만 실행하십시오.
- 컨테이너·이미지 삭제에는 명시적인 확인이 필요합니다.
