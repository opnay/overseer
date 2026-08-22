# Overseer

Lima의 공식 Docker 템플릿으로 만든 전용 VM을 브라우저에서 관리하는 로컬 컨트롤 패널입니다. 호스트에는 이미 설치된 `lima`, `docker` CLI만 사용하며, 전역 Docker context를 변경하지 않습니다.

## 요구 사항

- macOS
- Lima 2.0 이상
- Docker CLI
- Node.js 24 이상
- pnpm 11

## 시작

```bash
pnpm install
pnpm dev
```

기본 주소는 `http://overseer.localhost:1355`입니다. Portless가 실제 앱에 비어 있는 포트를 자동 배정합니다. Portless를 통하지 않으려면 `pnpm dev:direct`를 사용하십시오.

리소스는 독립 URL에서 관리합니다.

- `/containers`: 실행·중지·재시작·로그·삭제
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

## 안전 경계

- 서버는 `127.0.0.1`에만 바인딩합니다.
- 컨테이너 포트는 기본적으로 `127.0.0.1`의 빈 포트에 게시합니다.
- 브라우저 요청으로 임의 셸 명령을 실행할 수 없습니다.
- 전역 Docker context와 `/var/run/docker.sock`을 변경하지 않습니다.
- 컨테이너·이미지 삭제에는 명시적인 확인이 필요합니다.
