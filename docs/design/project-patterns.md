# Overseer 프로젝트 패턴

## 목적과 우선순위

이 문서는 `DESIGN.md`의 프로젝트 패턴 계약을 Overseer 화면에 적용합니다. 페이지를 만들거나 수정할 때 `사용자 목표 > 프로젝트 패턴 > 컴포넌트 구성 > 레이아웃 구성 > 페이지 동작` 순서로 판단하십시오.

규칙 우선순위는 다음과 같습니다.

1. 현재 사용자 요청과 `AGENTS.md`
2. `DESIGN.md`
3. 이 문서
4. `docs/decisions/0003-operation-interface-patterns.md`
5. 인접 화면과 기존 구현

## 공통 화면 계약

### 영역과 읽기 순서

모든 기본 화면은 다음 DOM 순서를 유지합니다. 좁은 화면에서도 CSS `order`, `row-reverse`, `column-reverse`로 시각 순서를 바꾸지 않습니다.

1. 페이지 맥락·제목·설명
2. 유틸리티 액션과 대표 액션
3. 전역 또는 페이지 상태 피드백
4. 패턴 본문

페이지 제목은 `city-text-page-title`, 본문 영역 제목은 `city-text-section-title`, 하위 섹션 제목은 `city-text-subsection-title`을 사용합니다. heading 수준은 시각 크기가 아니라 문서 구조를 따릅니다.

### 페이지 맥락과 액션

- 목록·설정 화면의 eyebrow는 해당 항목이 속한 주요 탐색 카테고리명만 사용합니다. `도커`, `엔진`, `공급자`, `CLI`를 사용하고, 하단 공통 메뉴인 작업 기록·일반 설정은 `Overseer`를 사용합니다.
- 상세 화면은 breadcrumb가 상위 경로와 현재 리소스를 표시하므로 eyebrow를 추가하지 않습니다. Startup은 단계 탐색이 맥락을 소유하므로 공통 페이지 헤더를 사용하지 않습니다.
- 페이지 액션의 DOM 순서는 `utility group > primary or management group`입니다. 데스크톱에서는 한 행에 배치하고 모바일에서는 그룹을 두 행으로 재배치합니다.
- 한 관리 그룹 안의 직접 명령과 overflow 메뉴는 같은 행을 유지합니다. 텍스트 명령은 남는 폭을 사용할 수 있지만 아이콘 메뉴를 별도 행으로 밀어내지 않습니다.
- 요약 surface의 값은 비교에 필요한 실제 정보이므로 무조건 말줄임하지 않습니다. 긴 이미지명·포트·가상화 방식·시각은 영역 안에서 줄바꿈하여 전체 값을 확인할 수 있어야 합니다.

### 전역 탐색

- 첫 열은 도커·엔진·공급자·CLI 영역 선택입니다. 영역 선택은 두 번째 열의 메뉴만 바꾸며, 메뉴 링크를 선택할 때 본문과 URL이 이동합니다.
- 도커는 Compose·컨테이너·이미지·볼륨·네트워크, 엔진은 인스턴스·엔진 설정·네트워크 설정, 공급자는 이미지 저장소, CLI는 도구를 제공합니다.
- 작업 기록·일반 설정은 첫 열 하단의 공통 링크입니다.
- 상세 화면의 두 번째 열은 목록 복귀와 리소스 섹션을 제공합니다. 설정은 선택 영역의 설정 섹션을 표시합니다.
- 영역 버튼은 City DS `Button iconOnly`, `Tooltip`, `aria-pressed`와 아이콘 획 변화로 상태를 표시합니다. 링크의 현재 위치는 `aria-current="page"`로 표시합니다.
- 직접 URL·브라우저 뒤로가기는 현재 영역·페이지·섹션을 복원합니다. 페이지가 상세 메뉴를 소유하며 shared 탐색 슬롯을 통해 App Shell에 배치합니다.

### 간격 소유권

| 경계                    | 소유자              | 기본 간격                                   |
| ----------------------- | ------------------- | ------------------------------------------- |
| viewport와 페이지       | App Shell           | 데스크톱 `space-8`, 모바일 `space-4` gutter |
| 페이지 헤더·피드백·본문 | App Shell           | `space-6`                                   |
| 서브 탐색과 콘텐츠      | Sectioned Workspace | 데스크톱 `space-8`, 모바일 `space-5`        |
| 콘텐츠 헤더와 본문      | Sectioned Workspace | `space-6`                                   |
| 독립 섹션 사이          | 패턴 본문           | `space-8`                                   |
| 섹션 제목과 내용        | Section             | `space-4`                                   |
| 컴포넌트 내부           | City DS 컴포넌트    | 컴포넌트 density 계약                       |

부모가 자식 사이 `gap`과 자신의 `padding`을 소유합니다. 자식은 같은 경계에 외부 margin을 추가하지 않습니다. breakpoint는 레이아웃 간격과 재배치만 바꾸며 제어 크기나 컴포넌트 내부 padding을 바꾸지 않습니다.

### 액션과 표면

- 페이지 액션 그룹에는 대표 `primary` 액션을 하나만 둡니다.
- 뒤로가기와 새로고침은 대표 액션보다 먼저 읽히는 utility 그룹에 둡니다.
- 행 액션은 `sm`, 폼과 일반 페이지 액션은 같은 그룹 안에서 같은 크기를 사용합니다.
- 행에서 바로 이해되는 상세·시작·중지·재시작·로그·설정·삭제 아이콘은 빠른 작업으로 유지할 수 있습니다. 텍스트 설명 없이는 결과를 예측하기 어려운 명령과 여러 관리 명령은 `Menu`로 묶습니다.
- 페이지 배경은 flat입니다. 독립된 데이터·상태·작업 경계만 raised 또는 outline surface를 사용합니다.
- 하위 섹션은 카드 중첩 대신 제목, 간격과 divider로 구분합니다.
- 요약 surface는 사용자가 다음 행동을 결정하는 현재 상태에만 사용합니다.

### 상태와 소유권

- App Shell은 라우팅, 전역 탐색, 전역 요청 실패와 작업 피드백을 소유합니다.
- page slice는 실제 데이터, 도메인 상태, 액션, 오류 원인과 복구 흐름을 소유합니다.
- `shared/ui`는 도메인 상태나 endpoint를 알지 않는 반복 레이아웃과 접근성 계약만 소유합니다.
- 로딩은 실제 구조를 닮은 `Skeleton`, 빈 상태는 해당 데이터 영역 안의 `EmptyState`, 복구 가능한 오류는 원인과 다음 행동을 포함한 `Alert`를 사용합니다.
- 새로고침 중 기존 데이터가 있으면 제거하지 않고 갱신 상태만 표시합니다.

## 라우트와 패턴 매핑

| 라우트                                                                                                      | 프로젝트 패턴      | 변형                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------- |
| `/compose`, `/containers`, `/images`, `/volumes`, `/networks`, `/instances`                                 | ResourceCollection | 기본 리소스 목록                  |
| `/image-repositories`                                                                                       | ResourceCollection | 외부 저장소 목록                  |
| `/docker-plugins`                                                                                           | ResourceCollection | Docker CLI 도구 목록              |
| `/operations`                                                                                               | ResourceCollection | 작업 상세 Dialog와 LogViewer 포함 |
| `/compose/:name`, `/containers/:id`, `/images/:id`, `/volumes/:name`, `/networks/:name`, `/instances/:name` | ResourceDetail     | Sectioned Workspace 상세          |
| `/image-repositories/:id`                                                                                   | ResourceDetail     | 단일 콘텐츠 상세                  |
| `/settings`                                                                                                 | SettingsWorkspace  | 범주형 Sectioned Workspace        |
| `/startup`                                                                                                  | GuidedSetup        | 순차 준비 흐름                    |

`ResourceDetail`의 단일 콘텐츠 변형은 현재 선택 가능한 상세 섹션이 하나뿐일 때만 Sectioned Workspace를 생략합니다. 섹션이 둘 이상 생기면 기본 ResourceDetail 구성으로 전환합니다.

## ResourceCollection

### 사용자 목표와 적용 조건

여러 리소스를 비교하고 하나를 선택해 상세나 작업으로 이동하는 반복 업무에 사용합니다. Compose, 컨테이너, 이미지, 인스턴스, 볼륨, 네트워크, 이미지 저장소, Docker CLI 도구와 작업 목록에 적용합니다. 순서가 있는 준비 과정이나 하나의 리소스를 깊게 읽는 화면에는 사용하지 않습니다.

### 구성과 레이아웃

`Page Header > Feedback > DataTableRegion > Table` 순서를 사용합니다. 큰 결과 집합은 같은 데이터 영역 안에서 `FilterBar > Table > Pagination` 순서로 구성하고 서버 조회도 같은 필터·페이지 계약을 사용합니다.

- 데이터 영역은 outline 또는 raised surface 하나만 사용합니다.
- Table은 `sm` 크기와 compact 정보 밀도를 사용합니다.
- 넓은 주요 열은 하나만 두고 나머지는 콘텐츠 기반 최소 폭을 사용합니다.
- 빈 상태는 `Table.StateRow` 안의 compact `EmptyState`로 표시합니다.
- 상세 진입은 주요 셀의 링크, 자주 쓰는 행 명령은 `sm` ghost 버튼으로 표시합니다.
- 비교 폭이 viewport를 넘으면 `DataTableRegion`만 가로 스크롤합니다.

### 필수 상태와 완료 기준

- 로딩, 빈 상태, 정상, 갱신, 오류, 행 작업 중, 행 작업 실패를 구분합니다.
- 키보드로 주요 셀 링크와 모든 행 액션에 접근할 수 있어야 합니다.
- 작은 화면에서도 페이지 본문은 넘치지 않고 Table 영역만 가로 스크롤해야 합니다.
- `Operations`는 이 패턴의 변형이며 상세 Dialog와 공통 `LogViewer`를 추가합니다.

## ResourceDetail

### 사용자 목표와 적용 조건

리소스 하나의 현재 상태, 구성, 관계와 원본 정보를 확인하고 안전하게 작업하는 화면에 사용합니다. Compose, 컨테이너, 이미지, 이미지 저장소, 인스턴스, 볼륨과 네트워크 상세에 적용합니다. 여러 리소스 비교나 전역 설정에는 사용하지 않습니다.

### 구성과 레이아웃

`Page Header > Feedback > Sectioned Workspace`를 사용합니다. Sectioned Workspace 안의 DOM 순서는 `Section Navigation > Content Header > Content Body`입니다.

- 42rem을 넘는 화면은 App Shell의 아이콘 영역 `4rem`과 메뉴 영역 `11rem`으로 구성합니다. 상세 섹션 탐색은 메뉴 영역에 렌더링하고 본문은 한 열을 유지합니다.
- 52rem 이하에서는 메뉴 영역 폭을 `10rem`으로 줄입니다. 42rem 이하에서는 전역 메뉴를 하나의 Drawer, 상세 섹션을 본문 위 `Select`로 제공합니다.
- Content Header는 리소스 종류, 현재 섹션 제목과 필요한 짧은 설명만 표시합니다.
- 개요의 핵심 상태 2~3개만 Summary surface에 표시합니다.
- 독립 섹션 사이는 `space-8`, 섹션 제목과 내용 사이는 `space-4`를 사용합니다.
- 원본 JSON·YAML과 긴 로그는 각 전용 viewer 안에서 스크롤합니다.

### 필수 상태와 완료 기준

- 상세 로딩, 리소스 없음, 섹션별 로딩, 오류, 정상, 명령 비활성을 구분합니다.
- 현재 섹션은 `aria-current="page"`와 시각 상태를 함께 표시합니다.
- 섹션 선택은 URL에 반영하여 새로고침·뒤로가기·링크 공유에서 현재 위치를 복원합니다.
- navigation label, heading 순서와 키보드 포커스 순서가 시각 순서와 같아야 합니다.
- 긴 식별자와 경로는 콘텐츠 영역 안에서 줄바꿈하며 페이지 폭을 늘리지 않아야 합니다.

## SettingsWorkspace

### 사용자 목표와 적용 조건

Overseer와 Docker Engine 설정을 범주별로 찾고 독립적으로 저장·초기화하는 화면에 사용합니다. 리소스 상태를 읽는 상세 화면이나 순차 준비 과정에는 사용하지 않습니다.

### 구성과 레이아웃

ResourceDetail과 같은 `Sectioned Workspace` 레이아웃을 사용하지만 탐색은 설정 범주별 group을 허용합니다.

- Content Header는 설정 범주, 현재 설정 영역과 변경 영향을 설명합니다.
- 관련 입력은 `Fieldset`, 개별 입력은 `Field`를 사용합니다.
- 각 독립 설정 섹션이 초기화·저장·오류 상태를 소유합니다.
- 한 섹션에는 primary 저장 액션을 하나만 둡니다.
- 일반 설정의 독립 이동 항목만 outline surface를 사용할 수 있습니다.
- 설정 섹션을 같은 모양의 카드로 반복하지 않고 제목, 간격과 divider로 구분합니다.

### 필수 상태와 완료 기준

- 초기 로딩, 조회 오류와 재시도, 사용 불가, 변경 없음, 변경됨, 저장 중, 저장 실패와 성공을 구분합니다.
- 일부 섹션 저장 실패가 다른 섹션의 draft를 제거하지 않아야 합니다.
- 모바일에서도 탐색, 입력, 초기화, 저장 순서가 DOM과 같아야 합니다.
- 설정 섹션 선택은 URL에 반영하여 새로고침·뒤로가기·링크 공유에서 현재 위치를 복원합니다.
- 오류는 해당 설정 섹션 가까이에서 원인과 복구 방법을 알려야 합니다.

## GuidedSetup

### 사용자 목표와 적용 조건

필수 도구와 Docker Engine을 정해진 순서로 준비하는 일회성 또는 복구 흐름에 사용합니다. Startup 화면에만 적용합니다. 병렬 설정이나 반복 리소스 관리에는 사용하지 않습니다.

### 구성과 레이아웃

`Brand > Step Navigation > Step Header > Guidance or Progress > Decision Actions` 순서를 유지합니다.

- 현재 단계와 완료 상태를 번호, 텍스트와 상태로 함께 표시합니다.
- 수동 명령과 자동 설치는 구분하되 같은 단계의 대안임을 유지합니다.
- 설치 감지 뒤 기존 가이드는 접고 로그·결과·다음 행동을 표시합니다.
- 사용자가 `다음`을 선택해야 다음 단계로 이동합니다.
- 좁은 화면에서도 이전·다음 액션의 DOM과 시각 순서를 바꾸지 않습니다.

### 필수 상태와 완료 기준

- 미설치, 설치 가능, 설치 중, 설치 완료, 설치 실패, 감지 완료와 다음 단계 대기를 구분합니다.
- 새로고침과 10초 자동 확인은 현재 단계와 사용자 선택을 잃지 않아야 합니다.
- 명령 복사, 자동 설치, 로그 확인과 다음 단계 이동을 키보드로 완료할 수 있어야 합니다.

## 공용 구현 경계

`SectionedWorkspace`만 `src/client/shared/ui`에 둡니다. 이 컴포넌트는 서브 탐색, 콘텐츠 헤더, 반응형 레이아웃과 접근성 상태만 소유하며 페이지 이름, API, 도메인 상태, 저장 정책을 알지 않습니다.

ResourceCollection의 Table 구성, ResourceDetail의 summary·section 내용, SettingsWorkspace의 Fieldset과 GuidedSetup의 단계 동작은 각 page slice에 유지합니다. 새 wrapper는 현재 소비자가 둘 이상이고 동일한 의미와 변경 이유를 가질 때만 추가합니다.

## 검증 매트릭스

- 기준 화면: 네트워크 목록, 인스턴스 상세, 설정, Startup
- viewport: 데스크톱, 52rem 이하 2열 탐색, 42rem 이하 모바일
- 테마: 라이트, 다크
- 입력: 포인터, Tab·Shift+Tab, Enter·Space
- 콘텐츠: 빈 데이터, 긴 이름·경로, 로딩, 오류·재시도, 비활성, 저장·작업 진행
- 구조: 모든 route가 하나의 패턴에 매핑되고 DOM 순서와 시각 순서가 일치
- 기술: FSD 경계 테스트, 타입 검사, 전체 테스트와 production build 통과
