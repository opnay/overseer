import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SectionedWorkspace } from "../src/client/shared/ui/sectioned-workspace/index.ts";

type TestSection = "general" | "network";

describe("SectionedWorkspace", () => {
  it("keeps navigation, content heading and body in reading order", async () => {
    const user = userEvent.setup();
    const onSectionChange = vi.fn();

    render(
      <SectionedWorkspace<TestSection>
        category="Docker Engine"
        description="Docker Engine의 외부 연결을 구성합니다."
        getSectionHref={(section) => `/settings?section=${section}`}
        groups={[
          {
            items: [{ label: "일반", value: "general" }],
            label: "Overseer",
          },
          {
            items: [{ label: "네트워크 설정", value: "network" }],
            label: "Docker Engine",
          },
        ]}
        navigationLabel="설정 상세 메뉴"
        onSectionChange={onSectionChange}
        section="network"
        title="네트워크 설정"
      >
        <p>설정 본문</p>
      </SectionedWorkspace>,
    );

    const navigation = screen.getByRole("navigation", { name: "설정 상세 메뉴" });
    expect(screen.getByRole("complementary", { name: "설정 상세 메뉴 영역" })).toContainElement(
      navigation,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "네트워크 설정" });
    const body = screen.getByText("설정 본문");
    expect(navigation.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(heading.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole("link", { name: "네트워크 설정" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "네트워크 설정" })).toHaveAttribute(
      "href",
      "/settings?section=network",
    );

    await user.click(screen.getByRole("link", { name: "일반" }));
    expect(onSectionChange).toHaveBeenCalledWith("general");

    await user.click(screen.getByRole("combobox", { name: "설정 상세 메뉴" }));
    await user.click(await screen.findByRole("option", { name: "일반" }));
    expect(onSectionChange).toHaveBeenLastCalledWith("general");
  });
});
