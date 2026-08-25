# 0002. Docker Engine 초기 구성과 VM 드라이버

## 상태

일부 대체. 초기 구성과 VZ·QEMU 결정은 유지하며 단일 `overseer` VM 가정과 설정 화면 구조는 0005에서 대체했습니다.

## 결정

- Overseer는 전역 단일 `overseer` Lima VM과 단일 Docker Engine만 관리합니다.
- **설정 > Docker Engine**의 **실행 환경**에서 VM 드라이버를 선택하고 **엔진 설정**에서 CPU, 메모리와 디스크를 구성합니다.
- 실행 환경은 현재 `Lima VM`만 지원합니다. VM별 엔진이나 다중 VM을 만들지 않습니다.
- VM 드라이버는 `vz` 또는 `qemu`이며 macOS 기본값은 `vz`입니다.
- QEMU 실행 파일이 없으면 QEMU 선택을 비활성화하고 사용자가 직접 설치하도록 안내합니다. 브라우저 요청으로 패키지를 설치하지 않습니다.
- 설정 원본은 `limactl list overseer --json`입니다. 인스턴스가 없을 때만 VZ, CPU 4개, 메모리 4GiB, 디스크 100GiB 기본값을 사용합니다.
- 기존 VM 설정 변경은 `overseer` 확인 문자열을 요구하는 명시적 재생성으로만 적용합니다.
- 새 VM은 macOS 홈 공유를 writable로 생성하고 `overseer` Docker context를 기본 context로 연결합니다.
- 기존 VM의 CLI 연결 복구는 VM 데이터를 삭제하지 않고 중지, writable mount 편집, 시작, context 갱신 순서로 처리합니다.

## 재생성 경계

1. 입력과 QEMU 가용성을 VM 중지 전에 검증합니다.
2. 실행 중이면 중지하고 기존 인스턴스를 삭제한 뒤 선택 설정으로 다시 생성합니다.
3. 삭제 후 생성 실패를 자동 복구하거나 자동 재시도하지 않습니다.
4. VM의 컨테이너·이미지·볼륨·사용자 네트워크와 VM 내부 Compose 데이터는 삭제됩니다.
5. 호스트 SQLite의 Compose 등록 정보와 작업 기록은 유지됩니다.

## 제외

- QEMU 자동 설치
- VM 백업·복원
- VM별 엔진, 다중 VM, 다중 Docker Engine
- Kata Containers 지원. Kata는 VM 드라이버가 아니라 별도의 OCI 격리 런타임입니다.
