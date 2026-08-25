# 0003. 운영 데이터 화면 컴포넌트 패턴

## 상태

채택. `DESIGN.md`를 상위 규칙으로 유지하면서 Overseer 운영 화면에서 반복되는 Table, 상태, 액션과 로그 표현을 구체화합니다.

## 화면 위계

- 페이지는 제목과 대표 액션, 데이터 영역, 상세 오버레이 순으로 읽힙니다.
- 페이지 제목은 `city-text-page-title`, 영역 제목은 `city-text-section-title`, 설명은 `city-text-supporting`을 사용합니다.
- Table의 주요 값은 14px semibold, 보조 맥락·시각·소요 시간은 12px을 사용합니다. 오류는 보조 색으로 약화하지 않습니다.

## Table

- 비교에 필요한 열만 독립 열로 둡니다. 대상 이름과 리소스처럼 작업을 설명하는 맥락은 주요 작업 셀에 함께 배치합니다.
- Table은 `max-content` intrinsic width를 사용하고 셀 내용을 화면 폭에 맞추기 위해 강제로 줄바꿈하지 않습니다.
- 각 Table에는 대표 제목·이미지처럼 넓게 읽어야 하는 열을 하나만 두며 최소 폭은 480px입니다. 추가로 넓은 정보가 필요하면 별도 열을 만들지 않고 대표 셀의 작은 두 번째 줄에 합칩니다.
- 나머지 열은 제목과 실제 콘텐츠의 자연 폭을 최소 폭으로 사용합니다. 상태·날짜·소요·액션 열에 화면 비율 기반 폭을 배분하지 않습니다.
- Table의 intrinsic width가 데이터 영역을 넘으면 화면 크기와 관계없이 `DataTableRegion` 안에서 가로 스크롤합니다. 페이지 본문 폭은 늘리지 않고 표를 카드 목록으로 바꾸지 않습니다.
- 빈 상태는 Table 안의 `EmptyState`로 표시하며 별도 카드나 중복 제목을 추가하지 않습니다.

## 날짜와 시각

- 사용자가 보는 날짜와 시각은 로컬 시간대의 `YYYY-MM-DD HH:mm:ss` 형식으로 통일합니다.
- ISO timestamp와 Docker CLI timestamp는 공통 formatter를 사용하며 상대 시각이나 locale별 오전·오후 표현을 섞지 않습니다.

## 상태와 색상

- 상태는 City DS `Badge`의 `subtle` appearance와 semantic tone으로만 표시합니다. Table과 Drawer에서는 12px 레이블을 유지하는 `lg` 크기를 사용합니다.
- 성공은 `success`, 실패는 `destructive`, 대기는 `neutral`, 진행은 `info`, 취소는 `neutral`입니다.
- 색상만으로 상태를 전달하지 않고 항상 상태 레이블을 함께 표시합니다.
- 오류 원인과 복구 안내는 `Alert` 또는 destructive 텍스트로 유지합니다.

## 액션

- 페이지 액션 그룹에는 하나의 primary만 둡니다.
- Table 행의 탐색·상세 액션은 `sm` ghost 버튼을 사용합니다.
- 재시도·삭제처럼 결과를 바꾸는 명령은 상세 Dialog나 Drawer에 두고, 확인과 영향을 읽은 뒤 실행하게 합니다.
- 같은 그룹의 버튼은 같은 크기를 사용하며, 아이콘 버튼은 `iconOnly`와 접근 가능한 이름을 제공합니다.
- 반응형 재배치로 액션의 역할과 variant를 바꾸지 않습니다. 작업 Drawer의 대표 이동 액션은 모든 화면 크기에서 primary를 유지합니다.

## 로그와 코드

- Docker·Compose·작업·설치 출력은 공통 `LogViewer`를 사용합니다. 줄 바꿈, 줄 번호와 폰트 크기 옵션을 동일하게 제공합니다.
- 각 Viewer는 설정 버튼 옆에 `크게 보기` 아이콘 버튼과 Tooltip을 제공하며, 기존 Dialog 안에서도 창 전체를 덮는 중첩 Dialog로 엽니다.
- YAML과 설치 명령 미리보기는 실행 로그가 아니므로 별도 코드 블록으로 유지합니다.
- 긴 로그는 Viewer 내부에서 스크롤하며 페이지 전체 폭을 늘리지 않습니다.

## 완료 기준

- 모든 viewport에서 Table만 intrinsic width로 스크롤되고 페이지 본문 overflow가 없습니다.
- 각 Table의 wide column은 하나이며 480px 이상이고, 다른 열은 내용이 강제 줄바꿈되지 않습니다.
- 라이트·다크·키보드에서 상태, 액션, 포커스와 로그 옵션을 구분할 수 있습니다.
- 로딩·빈 상태·오류·진행·완료·취소·재시도 가능 상태를 테스트합니다.

## 개발 환경

City DS는 로컬 tarball 의존성이므로 `pnpm dev`와 `pnpm dev:direct`는 Vite `--force`로 optimized dependency를 다시 만듭니다. 이전 prebundle이 남아 최신 컴포넌트 크기·semantic surface를 가리는 상태를 허용하지 않습니다.
