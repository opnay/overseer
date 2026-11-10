# macOS 수동 릴리즈

## GitHub Actions 릴리즈

`.github/workflows/release.yml`은 `deployments` 브랜치 푸시 또는 수동 실행으로 Apple Silicon 릴리즈를 만듭니다. 워크플로우가 `main`에 반영되기 전의 최초 테스트는 `deployments` 푸시로 시작합니다. 수동 실행은 `main` 또는 `deployments`에서 사용하십시오. 버전 파일과 `docs/releases/<버전>.md`를 먼저 커밋하며, 기존 공개 버전을 재사용하지 않습니다.

검사·테스트·프런트엔드 빌드는 Ubuntu의 재사용 Check job에서 수행하고 macOS release job은 `needs: checks`로 통과를 기다립니다. 두 job은 `pnpm/setup@v3.1.2`로 pnpm·Node를 함께 설치합니다. Bun은 기존 `scripts/build-sidecar.ts`의 단일 서버 실행 파일 컴파일에 필요하므로 macOS job에서만 설치합니다. 레지스트리 주소는 `.npmrc`, CI 인증 토큰의 환경변수 참조는 `.npmrc.ci`에서 관리합니다. Actions는 `NODE_AUTH_TOKEN`만 주입하며 파일에 실제 토큰을 저장하지 않습니다.

필요한 저장소 Actions Secrets는 `APPLE_CERTIFICATE`(Base64 p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`(앱 전용 암호), `APPLE_TEAM_ID`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`입니다. 인증서는 runner의 임시 키체인에 복원하고 종료 시 제거합니다. 공증 인증은 공식 액션의 Tauri 빌드에 전달합니다.

`tauri-apps/tauri-action@v1.0.0`이 앱·DMG 빌드, Apple 서명·공증, updater manifest 생성과 Draft 업로드를 담당합니다. 문서화된 `tauriScript` hook은 빌드를 한 번 호출한 뒤 앱의 경로 잔존·서명·공증 티켓·버전과 압축을 검사합니다. Rust 홈·작업 경로를 치환하고 압축 소유자를 정규화한 뒤 updater 서명을 다시 생성해 공식 액션이 검증된 파일을 업로드하도록 합니다.

Draft 자산은 다시 내려받아 GitHub digest, updater 공개키 서명, manifest 버전·다운로드 URL과 빌드 커밋을 확인합니다. 검증 후 체크섬 파일을 추가하고 정식 latest로 공개합니다. 원격 태그가 아직 없다면 검증 후 빌드 커밋으로 생성합니다. 공식 액션의 updater URL은 GitHub API asset URL일 수도 있으며 이 경우에도 해당 아카이브의 정확한 asset ID만 허용합니다. 이 workflow는 공개까지 수행하므로 테스트할 커밋과 버전을 확인한 뒤 푸시하십시오.

실패 시 공개된 버전·태그를 옮기거나 덮어쓰지 않습니다. 원격 태그만 생성된 경우 같은 커밋에서 재실행할 수 있습니다. draft가 남았다면 자산과 오류를 확인하고 해당 draft를 정리한 뒤 재실행하십시오. 다른 커밋을 가리키는 기존 태그는 거부합니다. Apple 서명 인증서의 개발자명은 경로 치환 대상이 아니며 CI에서도 공개됩니다.

## 배포 계약

앱의 **일반 설정 → 업데이트 관리 → 업데이트 확인**은 GitHub의 최신 정식 릴리즈에 있는 `latest.json`을 조회합니다. 새 버전은 사용자가 **업데이트 설치**를 눌러야 다운로드·서명 검증·설치되며, 성공하면 앱을 다시 엽니다. 실행·대기 중인 작업이 있으면 설치를 거부하고, 업데이트 중에는 새 변경 작업을 막습니다. 실행 중인 VM과 컨테이너는 종료하지 않습니다.

버전은 `package.json`을 기준으로 Tauri와 Cargo에 맞춥니다. 정식 `X.Y.Z`와 `vX.Y.Z` 태그만 지원하며, 태그는 빌드한 현재 커밋을 가리켜야 합니다. 일반 개발 빌드는 updater 서명 키 없이 가능합니다.

현재 빌드 머신의 아키텍처 한 개만 배포합니다. Apple Silicon에서는 `darwin-aarch64`, Intel에서는 `darwin-x86_64` 자산을 만듭니다. 두 아키텍처를 동시에 배포하는 manifest 병합은 이 도구의 범위가 아닙니다.

## 로컬 준비

- Node.js 24 이상, pnpm 11, Rust, Xcode CLI, Bun과 `gh` 인증이 필요합니다. `pnpm install --frozen-lockfile`로 의존성을 설치하십시오.
- Keychain에 Developer ID Application 인증서와 개인키가 있어야 합니다.
- `xcrun notarytool store-credentials overseer-notary`로 준비한 공증 프로필을 사용합니다. 다른 이름은 `OVERSEER_NOTARY_PROFILE`로 지정하십시오.
- updater 개인키는 기본 `~/.tauri/overseer.key`에서 읽습니다. 다른 파일은 `TAURI_SIGNING_PRIVATE_KEY_PATH`로 지정하십시오. `TAURI_SIGNING_PRIVATE_KEY`에 키 내용이나 파일 경로를 넣는 방식도 지원합니다.
- `src-tauri/tauri.conf.json`의 공개키와 짝을 이루는 개인키를 사용하십시오. 키와 비밀번호는 저장소에 넣지 마십시오. 키를 바꾸면 기존 앱이 새 서명을 검증하지 못합니다.

GitHub Secrets에 등록한 키는 이후 CI용입니다. 수동 도구는 Secrets를 내려받지 않으며 로컬 키를 사용합니다. macOS zsh에서 비밀번호를 숨김 입력하십시오.

```zsh
export APPLE_SIGNING_IDENTITY='Developer ID Application: inseop kim (5H87ZW7HFR)'
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/overseer.key"
read -rs 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD?업데이트 키 비밀번호: '
echo
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

비밀번호 없는 키라면 `export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''`를 사용하십시오.

## 버전 준비와 빌드

아래 `0.0.2`는 예시입니다. 작업 트리가 깨끗한 상태에서 시작하십시오. 도구는 커밋·태그·푸시를 자동 실행하지 않습니다.

```sh
pnpm release:version 0.0.2
git diff
pnpm check
cargo test --manifest-path src-tauri/Cargo.toml
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m 'chore: 0.0.2 릴리즈 준비'
git tag v0.0.2
```

릴리즈 노트를 저장소 밖의 파일에 작성한 뒤 빌드하십시오. 추적되지 않은 파일도 작업 트리 검증 대상입니다.

```sh
pnpm release:build /tmp/overseer-release-notes.md
pnpm release:verify
unset TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

빌드는 Developer ID로 앱과 DMG를 서명하고, 앱 ZIP과 DMG를 공증하여 `Accepted` 상태를 확인합니다. 두 대상에 티켓을 스테이플하고 Gatekeeper 검사를 통과한 뒤, **스테이플된 앱을 macOS 메타데이터 없이 다시 압축하여 최종 updater 파일을 서명**합니다. 앱 외부 경로·AppleDouble 항목·필수 파일 누락을 검사하고, 압축을 푼 앱의 서명과 Gatekeeper도 다시 검사합니다. 공개키로 서명을 검증한 뒤 자산을 확정합니다. Apple 공증용 ZIP은 업로드하지 않습니다.

자산은 `src-tauri/target/release/release-assets/v0.0.2/aarch64/`에 저장합니다.

- `Overseer_0.0.2_aarch64.dmg`: 직접 설치 및 이후 Homebrew cask용입니다.
- `Overseer_0.0.2_aarch64.app.tar.gz`, `.sig`: 앱 내 업데이트용입니다.
- `latest.json`: 버전, 릴리즈 노트, 아키텍처별 다운로드 URL과 서명 내용을 담습니다.
- `SHA256SUMS.txt`: 업로드할 파일의 SHA-256입니다.
- `release-record.json`, `release-notes.md`: 로컬 빌드 출처와 게시용 노트이며 업로드하지 않습니다.

## 게시

먼저 해당 DMG를 테스트 환경에서 설치하여 실행과 Gatekeeper 동작을 확인하십시오. 앱이 DMG 안에서 실행 중이면 종료하고 `/Applications`로 복사한 후 실행하십시오. 실제 릴리즈 게시 명령은 다음과 같습니다.

```sh
git push origin main
git push origin v0.0.2
pnpm release:publish
```

게시 도구는 로컬·원격 태그와 빌드 커밋, 서명, 압축 구조, 자산 목록·체크섬을 다시 검사합니다. GitHub draft를 만들고 자산을 업로드한 뒤 draft의 릴리즈 ID로 조회합니다. draft·태그·ID와 원격 SHA-256까지 일치해야 정식 latest 릴리즈로 공개합니다. 기존 릴리즈는 덮어쓰지 않습니다. 오류로 draft가 남으면 오류 원인과 자산을 확인한 뒤 해당 draft만 삭제하고 다시 게시하십시오. 이미 공개한 버전은 수정하지 말고 다음 버전으로 배포하십시오.

현재 `0.0.1` 앱에는 updater가 없으므로 최초 updater 포함 버전은 DMG로 수동 설치해야 합니다. 그 다음 버전부터 앱 내 업데이트를 사용할 수 있습니다. Homebrew cask 등록은 별도 작업입니다.

## 검증 범위

자동 검증은 UI 조회·오류·진행률, 작업 잠금과 복구, 버전·태그 불일치 거부, 실제 Tauri CLI의 폐기용 키 서명 및 파일·서명 변조 거부를 다룹니다. 실사용 키의 비밀번호는 테스트에서 읽지 않습니다.

첫 배포 전에는 updater 포함 버전 A에서 더 높은 버전 B로 다음을 수동 검증하십시오.

| 상황                                      | 기대 결과                                                       |
| ----------------------------------------- | --------------------------------------------------------------- |
| 현재 버전 이상이 없음                     | 최신 버전 안내, 설치 버튼 없음                                  |
| 신규 정식 릴리즈                          | 노트와 설치 버튼, 누르기 전 설치하지 않음                       |
| 오프라인·manifest 누락·지원 아키텍처 없음 | 오류 안내 후 다시 확인 가능                                     |
| 다운로드 실패·서명 불일치·설치 권한 오류  | 오류 안내, 새 변경 작업 및 설치 재시도 가능                     |
| 실행·대기 작업이 있음                     | 작업을 끝낸 뒤 설치하도록 안내                                  |
| 설치 중 창 닫기·Cmd+Q                     | 설치 유지, 완료 후 창을 열어 재실행                             |
| 로그인 자동 시작 후 업데이트              | 백그라운드 실행 인자를 상속하지 않고 창 표시                    |
| 설치 성공                                 | 기존 sidecar와 소켓 정리, 새 앱·sidecar 한 개, 데이터·설정 유지 |
| 재실행 후                                 | 새 버전 표시, VM·컨테이너 유지, 메뉴·로그인 시작 정상           |

설치 성공 후 LaunchServices 재실행에 실패하면 설치된 Overseer를 직접 실행하십시오. 실제 A→B 설치·재시작, 공증 서비스, GitHub 게시의 검증은 자동 테스트를 통과한 사실과 구분해야 합니다.
