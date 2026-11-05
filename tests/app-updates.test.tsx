import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateSettings } from "../src/client/pages/settings/ui/app-update-settings.tsx";
import * as api from "../src/client/pages/settings/api/app-updates.ts";

vi.mock("../src/client/pages/settings/api/app-updates.ts", () => ({
  supportsAppUpdates: vi.fn(),
  readAppVersion: vi.fn(),
  checkAppUpdate: vi.fn(),
  installAppUpdate: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.supportsAppUpdates).mockReturnValue(true);
  vi.mocked(api.readAppVersion).mockResolvedValue("0.0.1");
  vi.mocked(api.checkAppUpdate).mockResolvedValue({
    currentVersion: "0.0.1",
    version: "0.0.2",
    notes: "수정 내용",
  });
});

describe("업데이트 관리", () => {
  it("사용자가 확인할 때만 릴리즈를 조회하고 최신 버전을 표시합니다", async () => {
    vi.mocked(api.checkAppUpdate).mockResolvedValue({
      currentVersion: "0.0.1",
      version: null,
      notes: null,
    });
    render(<AppUpdateSettings />);
    expect(await screen.findByText("현재 버전 0.0.1")).toBeInTheDocument();
    expect(api.checkAppUpdate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
    expect(await screen.findByText("최신 버전입니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "업데이트 설치" })).not.toBeInTheDocument();
  });

  it("설치는 별도 선택으로 시작하며 진행률과 재시작 상태를 표시합니다", async () => {
    let progress: ((value: api.AppUpdateProgress) => void) | undefined;
    let finish: (() => void) | undefined;
    vi.mocked(api.installAppUpdate).mockImplementation((callback) => {
      progress = callback;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    render(<AppUpdateSettings />);
    await userEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
    expect(await screen.findByText("수정 내용")).toBeInTheDocument();
    expect(api.installAppUpdate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "업데이트 설치" }));
    expect(screen.getByRole("button", { name: "업데이트 확인" })).toBeDisabled();
    act(() => progress?.({ state: "downloading", downloaded: 50, total: 100 }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    act(() => progress?.({ state: "installing" }));
    expect(screen.getByText("업데이트 서명을 확인하고 설치하고 있습니다.")).toBeInTheDocument();
    await act(async () => {
      progress?.({ state: "restarting" });
      finish?.();
    });
    expect(screen.getByText("설치를 마쳤습니다. 앱을 다시 시작하고 있습니다.")).toBeInTheDocument();
  });

  it("조회와 설치 실패를 표시하고 다시 시도할 수 있습니다", async () => {
    vi.mocked(api.checkAppUpdate).mockRejectedValueOnce(new Error("네트워크 오류"));
    vi.mocked(api.installAppUpdate).mockRejectedValueOnce(new Error("서명 불일치"));
    render(<AppUpdateSettings />);
    await userEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
    expect(await screen.findByText("네트워크 오류")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
    await userEvent.click(await screen.findByRole("button", { name: "업데이트 설치" }));
    expect(await screen.findByText("서명 불일치")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "업데이트 설치" })).toBeEnabled(),
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("웹에서는 데스크톱 전용 안내를 제공하며 native API를 호출하지 않습니다", () => {
    vi.mocked(api.supportsAppUpdates).mockReturnValue(false);
    render(<AppUpdateSettings />);
    expect(screen.getByRole("button", { name: "업데이트 확인" })).toBeDisabled();
    expect(api.readAppVersion).not.toHaveBeenCalled();
    expect(api.checkAppUpdate).not.toHaveBeenCalled();
  });
});
