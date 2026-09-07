import { readFile } from "node:fs/promises";
import { CONTROL_SIZES } from "@opnay/city-ds-react";
import { describe, expect, it } from "vitest";

describe("City DS source contract", () => {
  it("pins the audited City DS main artifact", async () => {
    const [agents, appStyles, design, packageJson, styles] = await Promise.all([
      readFile("AGENTS.md", "utf8"),
      readFile("src/client/app/styles/app.css", "utf8"),
      readFile("DESIGN.md", "utf8"),
      readFile("package.json", "utf8"),
      readFile("node_modules/@opnay/city-ds-react/dist/styles.css", "utf8"),
    ]);

    expect(agents.trim()).toBe(
      [
        "- city-ds가 적용되어야 합니다. DESIGN.md를 1순위 규칙으로 지켜야합니다.",
        "- Table·목록의 행 작업은 아이콘만으로 의미가 명확한 단일 명령을 City DS `Button`의 `iconOnly`로 직접 노출하고 `aria-label`과 `Tooltip`을 제공합니다. 눌림 상태는 `aria-pressed`와 아이콘 형태로 함께 표시합니다. 그 밖의 보조 작업은 City DS `Menu`에 두며 trigger는 `Ellipsis` `iconOnly` 버튼을 사용하고 텍스트 `작업` 드롭다운을 만들지 않습니다.",
        "- `src/client`의 파일 생성·이동·분리, import 변경, 구조 리팩터링이나 아키텍처 리뷰 전에는 반드시 `.agents/skills/frontend-fsd-architecture/SKILL.md`를 읽고 준수해야 합니다.",
        "- 프론트엔드 FSD 작업에서는 `app → pages → shared` 의존 방향, page slice 격리, `index.ts` public API 규칙을 예외 없이 지키고 `tests/client-architecture.test.ts`로 검증해야 합니다.",
        "- 서버는 `docs/decisions/0007-server-modular-monolith.md`의 `app → application/modules → infrastructure/core` 책임 경계와 module `index.ts` 공개 API 규칙을 지키고 `tests/server-architecture.test.ts`로 검증해야 합니다.",
        "- `src-tauri`의 파일 생성·이동·분리와 수명주기 변경 전에는 `docs/decisions/0008-macos-background-app-lifecycle.md`와 `docs/decisions/0009-tauri-shell-modules.md`를 읽고 Tauri shell 모듈 책임과 의존 방향을 지켜야 합니다.",
      ].join("\n"),
    );
    expect(packageJson).toContain('"@opnay/city-ds-react": "0.2.0"');
    expect(design).toContain("16px inline gutter");
    expect(design).toContain("Drawer의 스크롤 본문은 `Drawer.Content`를 사용하십시오.");
    expect(design).toContain("`SearchInput.Root`는 기본적으로 `div`를 렌더합니다.");
    expect(styles).toContain(".city-text-page-title");
    expect(styles).toContain(".city-toast-root");
    expect(appStyles).toContain("@media (pointer: coarse)");
    expect(appStyles).toContain("min-height: var(--city-hit-target-min)");
    expect(CONTROL_SIZES).toEqual(["xsm", "sm", "md", "lg", "xlg"]);
  });
});
