# 0004. Rootless Docker daemon 설정 관리

## 상태

채택. Engine 내부 설정 경계는 유지하며 단일 `overseer` VM 가정은 0005에서 대체했습니다.

## 결정

- **설정 > Docker Engine > 엔진 설정**에서 안정성·로그·전송과 추가 JSON을 관리합니다.
- **설정 > Docker Engine > 네트워크 설정**에서 DNS·주소 풀·Registry·Proxy를 관리합니다.
- 설정 원본은 `overseer` VM의 rootless Docker가 사용하는 `~/.config/docker/daemon.json`입니다. 호스트 SQLite에 설정을 중복 저장하지 않습니다.
- 안정성·로그·전송·고급 JSON·네트워크·Registry·Proxy는 각각 독립 저장·초기화 단위입니다.
- 부분 저장 작업은 실행 시점의 최신 daemon 설정을 다시 읽고 선택 섹션만 병합하여 다른 섹션을 보존합니다.
- 폼에서 관리하지 않는 기존 JSON 키는 추가 JSON 영역에 보존합니다. 폼 관리 키와 추가 JSON 키의 중복은 거부합니다.
- `data-root`, 스토리지 백엔드, `containerd-snapshotter`, daemon socket, cgroup, iptables와 OCI runtime은 구조화 폼에서 변경하지 않습니다.
- 설정 요청 본문은 작업 재시도 정보나 SQLite에 저장하지 않습니다.

## 적용과 실패 경계

1. 서버 입력을 섹션 계약으로 검증하고 최신 daemon 설정에 허용된 키만 병합합니다.
2. VM 내부 임시 파일에 병합한 설정을 씁니다.
3. `dockerd --validate`가 성공한 경우에만 임시 파일을 원본 경로로 이동합니다.
4. rootless Docker systemd 사용자 서비스만 다시 시작하며 Lima VM은 재생성하지 않습니다.
5. Docker socket 준비 확인에 실패하면 이전 파일을 복구하고 daemon을 다시 시작합니다.
6. 이전 설정 복구도 실패하면 상태를 숨기지 않고 작업을 실패로 남깁니다.

## 영향 안내

- 기본 로그 설정은 새 컨테이너부터 적용됩니다.
- 네트워크 주소 풀 변경은 새 네트워크부터 적용됩니다.
- live restore는 Docker daemon 중단에만 적용되며 Lima VM 중지·삭제를 보호하지 않습니다.
