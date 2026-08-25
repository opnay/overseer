# 0005. Lima 인스턴스 관리와 단일 활성 Engine

## 상태

채택. 0001·0002·0004의 `overseer` 단일 VM 가정을 대체하되 한 번에 하나의 Docker Engine만 관리하는 경계는 유지합니다.

## 결정

- `limactl list --json`으로 로컬 Lima 인스턴스를 발견하고 호환성, 준비 상태와 실제 VM 자원을 표시합니다.
- 여러 Lima 인스턴스 중 하나만 활성 Docker Engine으로 선택합니다. 활성 이름과 Overseer가 만든 인스턴스 목록만 호스트 SQLite에 저장하며 VM 설정은 중복 저장하지 않습니다.
- 저장된 선택이 없으면 기존 `overseer` 인스턴스를 기본 대상으로 사용합니다. `OVERSEER_LIMA_INSTANCE`가 있으면 선택을 해당 이름으로 고정합니다.
- Docker socket forwarding과 지원 VM 드라이버가 확인된 인스턴스만 호환 대상으로 봅니다. macOS 홈 공유도 writable이면 준비 완료입니다.
- 외부에서 만든 호환 인스턴스는 준비·선택·시작·중지할 수 있지만 Overseer가 삭제하거나 재생성하지 않습니다.
- 새 인스턴스는 사용자가 지정한 이름, VZ 또는 QEMU, CPU·메모리·디스크와 `template:docker`로 만들고 Overseer 관리 대상으로 기록합니다.
- 실행 환경은 현재 Lima VM 단일 옵션이므로 Select를 비활성화합니다. 구현이 추가될 때 같은 가상화 설정 경계에서 확장합니다.
- macOS Docker context 이름은 `overseer`로 유지하고 활성 인스턴스가 바뀔 때 socket endpoint만 갱신합니다.

## 데이터 흐름

1. 설정 화면이 인스턴스 목록을 요청합니다.
2. 서버가 Lima JSON을 읽고 각 인스턴스의 설정·socket forwarding·홈 공유·Docker 응답을 판정합니다.
3. 사용자가 준비된 인스턴스를 선택하면 Docker context endpoint를 갱신한 뒤 활성 이름을 저장합니다.
4. 이후 Dashboard와 Docker 명령은 활성 인스턴스의 Unix socket을 직접 사용합니다.

## 실패와 안전 경계

- 호환되지 않은 인스턴스는 선택하지 않습니다.
- 홈 공유가 읽기 전용이면 명시적인 준비 작업에서만 중지·편집·재시작합니다.
- 외부 인스턴스에는 삭제·재생성을 허용하지 않습니다.
- 생성 후 Docker 준비가 실패하면 실패를 숨기지 않고 생성된 인스턴스를 관리 대상으로 남겨 후속 조치가 가능하게 합니다.
- 선택값과 실제 Lima 목록이 어긋나면 목록에 상태를 드러내며 VM 설정을 SQLite 값으로 덮어쓰지 않습니다.

## 비목표

- 둘 이상의 Docker Engine 동시 연결
- 외부 인스턴스 삭제·재생성
- VM 백업·복원
- Lima 이외 실행 환경과 Kata Containers
