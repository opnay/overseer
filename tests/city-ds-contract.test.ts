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
        "- `src/client`의 파일 생성·이동·분리, import 변경, 구조 리팩터링이나 아키텍처 리뷰 전에는 반드시 `.agents/skills/frontend-fsd-architecture/SKILL.md`를 읽고 준수해야 합니다.",
        "- 프론트엔드 FSD 작업에서는 `app → pages → shared` 의존 방향, page slice 격리, `index.ts` public API 규칙을 예외 없이 지키고 `tests/client-architecture.test.ts`로 검증해야 합니다.",
      ].join("\n"),
    );
    expect(packageJson).toContain("opnay-city-ds-react-0.1.0-1dd3d58.tgz");
    expect(design).toContain("16px inline gutter");
    expect(styles).toContain(".city-text-page-title");
    expect(appStyles).toContain("@media (pointer: coarse)");
    expect(appStyles).toContain("min-height: var(--city-hit-target-min)");
    expect(CONTROL_SIZES).toEqual(["xsm", "sm", "md", "lg", "xlg"]);
  });
});
