# 0001. Lima 런타임과 로컬 주소

> `overseer` 단일 인스턴스와 다중 인스턴스 비목표는 0005에서 대체했습니다. Lima socket 직접 연결과 로컬 주소 결정은 유지합니다.

## 결정

- 컨테이너 런타임은 Lima의 `template:docker`로 만든 `overseer` 인스턴스만 사용합니다.
- macOS Docker CLI에 `overseer` context를 생성·갱신하고 기본 context로 선택합니다.
- Overseer 서버의 Docker 명령은 사용자가 다른 context로 전환해도 관리 대상을 잃지 않도록 인스턴스 Unix socket을 `--host`로 직접 지정합니다.
- macOS 홈 디렉터리는 Lima에 쓰기 가능하게 공유하여 로컬 `docker compose`의 상대 bind mount가 Compose 파일 옆의 호스트 경로를 사용하게 합니다.
- URL·폼 Compose도 macOS에 materialize한 파일을 host Docker CLI에서 실행하며 VM 내부에 파일을 복사하거나 `docker compose`를 실행하지 않습니다.
- 개발 주소는 프로젝트 dependency인 Portless로 제공하며 앱 포트는 자동 배정합니다.
- 초기 설정은 TLS·인증서·`/etc/hosts` 변경 없이 `http://overseer.localhost:1355`를 사용합니다.

## 비교

| 선택지             | 장점                                                      | 현재 판단                                    |
| ------------------ | --------------------------------------------------------- | -------------------------------------------- |
| Portless           | `.localhost` 이름, 앱 포트 자동 배정, 프로젝트 dependency | 채택                                         |
| Localias           | 포트 없는 TLS 주소, 공유 설정                             | 별도 바이너리와 hosts·CA 변경이 필요해 제외  |
| Caddy 직접 구성    | 유연한 리버스 프록시                                      | 별도 daemon과 설정 소유 비용으로 제외        |
| Node/Vite 포트 `0` | dependency 없이 충돌 회피                                 | 주소가 매번 바뀌므로 직접 실행 폴백으로 유지 |

## 실패 흐름

1. Lima 인스턴스가 없으면 생성 액션만 제공합니다.
2. 인스턴스가 중지되면 시작 액션을 제공합니다.
3. VM은 실행 중이지만 Docker socket이 준비되지 않으면 준비 중 상태로 표시합니다.
4. `overseer` context가 없거나 다른 endpoint를 가리키면 설정 화면에서 생성·갱신합니다.
5. macOS 홈 공유가 읽기 전용이면 확인 후 VM을 중지하고 writable로 편집한 뒤 다시 시작합니다.
6. CLI 실패는 숨기지 않고 복구 행동과 함께 화면에 표시합니다.

## 비목표

- Compose 편집
- Kubernetes 관리
- 브라우저 터미널
- 원격 접근
- 다중 런타임 추상화
