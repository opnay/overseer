import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { useUrlSection } from "../src/client/shared/lib/url-section/index.ts";

const sections = ["general", "engine", "network"] as const;

function SectionProbe() {
  const [section, setSection] = useUrlSection({
    defaultValue: "general",
    values: sections,
  });
  return (
    <div>
      <span>{section}</span>
      <button onClick={() => setSection("engine")} type="button">
        엔진 설정
      </button>
    </div>
  );
}

describe("useUrlSection", () => {
  it("persists a selected section in the URL and restores it after mounting", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/settings?section=network");
    render(<SectionProbe />);
    expect(screen.getByText("network")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "엔진 설정" }));
    expect(window.location.search).toBe("?section=engine");
    expect(screen.getByText("engine")).toBeInTheDocument();

    cleanup();
    render(<SectionProbe />);
    expect(screen.getByText("engine")).toBeInTheDocument();

    act(() => {
      window.history.pushState(null, "", "/settings?section=network");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByText("network")).toBeInTheDocument();
  });

  it("falls back to the default for an unknown section", () => {
    window.history.replaceState(null, "", "/settings?section=unknown");
    render(<SectionProbe />);
    expect(screen.getByText("general")).toBeInTheDocument();
  });
});
