import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { BrowserRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { useUrlSection } from "../src/client/shared/lib/url-section/index.ts";

const sections = ["general", "engine", "network"] as const;

function SectionProbe() {
  const [section, setSection, getSectionHref] = useUrlSection({
    defaultValue: "general",
    values: sections,
  });
  return (
    <div>
      <span>{section}</span>
      <button onClick={() => setSection("engine")} type="button">
        엔진 설정
      </button>
      <a href={getSectionHref("network")}>네트워크 설정</a>
      <a href={getSectionHref("general")}>일반 설정</a>
    </div>
  );
}

describe("useUrlSection", () => {
  it("persists a selected section in the URL and restores it after mounting", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/settings?section=network");
    render(
      <BrowserRouter>
        <SectionProbe />
      </BrowserRouter>,
    );
    expect(screen.getByText("network")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "네트워크 설정" })).toHaveAttribute(
      "href",
      "/settings?section=network",
    );
    expect(screen.getByRole("link", { name: "일반 설정" })).toHaveAttribute("href", "/settings");

    await user.click(screen.getByRole("button", { name: "엔진 설정" }));
    expect(window.location.search).toBe("?section=engine");
    expect(screen.getByText("engine")).toBeInTheDocument();

    cleanup();
    render(
      <BrowserRouter>
        <SectionProbe />
      </BrowserRouter>,
    );
    expect(screen.getByText("engine")).toBeInTheDocument();

    act(() => window.history.back());
    await waitFor(() => expect(screen.getByText("network")).toBeInTheDocument());
    act(() => window.history.forward());
    await waitFor(() => expect(screen.getByText("engine")).toBeInTheDocument());
  });

  it("falls back to the default for an unknown section", () => {
    window.history.replaceState(null, "", "/settings?section=unknown");
    render(
      <BrowserRouter>
        <SectionProbe />
      </BrowserRouter>,
    );
    expect(screen.getByText("general")).toBeInTheDocument();
  });
});
