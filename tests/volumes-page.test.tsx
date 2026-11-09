import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { VolumesPage } from "../src/client/pages/volumes/index.ts";

it("aliases labeled anonymous volumes while retaining their real navigation and action identity", async () => {
  const user = userEvent.setup();
  const anonymous = {
    name: "a".repeat(64),
    driver: "local",
    scope: "local",
    labels: "team=dev,com.docker.volume.anonymous=",
  };
  const unmarked = { ...anonymous, name: "b".repeat(64), labels: "" };
  const named = { ...anonymous, name: "pgdata", labels: "com.docker.volume.anonymous.extra=true" };
  const onInspect = vi.fn();
  render(
    <VolumesPage
      volumes={[anonymous, unmarked, named]}
      isBusy={() => false}
      onInspect={onInspect}
      onRemove={vi.fn()}
    />,
  );

  const link = screen.getByRole("link", { name: `docker:anonymous ${anonymous.name}` });
  expect(link).toHaveTextContent("docker:anonymous");
  expect(link).toHaveAttribute("href", `/volumes/${anonymous.name}`);
  expect(screen.getByText(anonymous.name)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: unmarked.name })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "pgdata" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: `${anonymous.name} 볼륨 삭제` })).toBeInTheDocument();
  await user.click(link);
  expect(onInspect).toHaveBeenCalledWith(anonymous);
  expect(screen.queryByRole("columnheader", { name: "레이블" })).not.toBeInTheDocument();
});
