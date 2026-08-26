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
      "- city-ds가 적용되어야 합니다. DESIGN.md를 1순위 규칙으로 지켜야합니다.",
    );
    expect(packageJson).toContain("opnay-city-ds-react-0.1.0-1dd3d58.tgz");
    expect(design).toContain("16px inline gutter");
    expect(styles).toContain(".city-text-page-title");
    expect(appStyles).toContain("@media (pointer: coarse)");
    expect(appStyles).toContain("min-height: var(--city-hit-target-min)");
    expect(CONTROL_SIZES).toEqual(["xsm", "sm", "md", "lg", "xlg"]);
  });
});
