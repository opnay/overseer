import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  ImageRepositoriesPage,
  ImageRepositoryDetailPage,
} from "../src/client/pages/image-repositories/index.ts";

it("shows Official only for repository rows classified by the API", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            repositories: [
              {
                id: "hub",
                repository: "docker.io/library/node",
                official: true,
                createdAt: "2026-11-01T00:00:00Z",
              },
              {
                id: "ghcr",
                repository: "ghcr.io/library/node",
                official: false,
                createdAt: "2026-11-01T00:00:00Z",
              },
            ],
          }),
        ),
    ),
  );
  render(
    <ImageRepositoriesPage
      isBusy={() => false}
      onInspect={vi.fn()}
      onRemove={vi.fn()}
      onSync={vi.fn()}
      refreshToken="initial"
    />,
  );
  const hub = await screen.findByRole("link", { name: "docker.io/library/node" });
  expect(within(hub.closest("tr")!).getByText("Official")).toBeInTheDocument();
  const ghcr = screen.getByRole("link", { name: "ghcr.io/library/node" });
  expect(within(ghcr.closest("tr")!).queryByText("Official")).not.toBeInTheDocument();
});

it("requests tag sorting, resets pages, and reloads favorites without search controls", async () => {
  const user = userEvent.setup();
  const digest = `sha256:${"a".repeat(64)}`;
  const platforms = ["linux/amd64", "linux/arm64/v8"];
  let favorite = false;
  const requests: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    let response: unknown;
    if (init?.method === "PATCH") {
      favorite = (JSON.parse(String(init.body)) as { favorite: boolean }).favorite;
      response = { tag: { favorite, name: "v2" } };
    } else if (url.pathname.endsWith("/tags")) {
      requests.push(url.search);
      const page = Number(url.searchParams.get("page"));
      response = {
        tags: {
          count: 26,
          totalCount: 26,
          page,
          pageSize: 25,
          repository: "ghcr.io/opnay/overseer",
          tags:
            page === 2
              ? [{ favorite: false, digest, platforms, name: favorite ? "v3" : "v2" }]
              : favorite
                ? [
                    { favorite: true, digest, platforms, name: "v2" },
                    { favorite: false, digest, platforms, name: "v9" },
                  ]
                : [
                    {
                      favorite: false,
                      digest,
                      platforms,
                      name: url.searchParams.get("sort") === "-tag" ? "v9" : "v1",
                    },
                  ],
        },
      };
    } else {
      response = {
        repository: {
          createdAt: "2026-11-06T00:00:00Z",
          favoriteCount: 0,
          id: "repository-id",
          repository: "ghcr.io/opnay/overseer",
        },
      };
    }
    return new Response(JSON.stringify(response));
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <ImageRepositoryDetailPage
      id="repository-id"
      isBusy={() => false}
      onCreateContainer={vi.fn()}
      onDownload={vi.fn()}
      onRepositoryChange={vi.fn()}
      refreshToken="initial"
      runtimeAvailable
    />,
  );

  expect(await screen.findByText("v1")).toBeInTheDocument();
  expect(await screen.findByText("linux/amd64")).toBeInTheDocument();
  expect(screen.getByText("linux/arm64/v8")).toBeInTheDocument();
  expect(screen.queryByText(digest)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "갱신일 내림차순 정렬" })).toBeDisabled();
  expect(screen.queryByText("ghcr.io/opnay/overseer:v1")).not.toBeInTheDocument();
  expect(requests.at(-1)).toBe("?page=1&sort=tag");
  await user.click(screen.getByRole("button", { name: "2페이지" }));
  expect(await screen.findByText("v2")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "태그 내림차순 정렬" }));
  expect(await screen.findByText("v9")).toBeInTheDocument();
  expect(requests.at(-1)).toBe("?page=1&sort=-tag");
  expect(screen.getByRole("columnheader", { name: /태그/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );

  await user.click(screen.getByRole("button", { name: "2페이지" }));
  await user.click(await screen.findByRole("button", { name: "v2 즐겨찾기 추가" }));
  await waitFor(() => expect(requests.at(-1)).toBe("?page=1&sort=-tag"));
  expect(await screen.findByRole("button", { name: "v2 즐겨찾기 해제" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const table = screen.getByRole("table");
  expect(within(within(table).getAllByRole("row")[1]!).getByText("v2")).toBeInTheDocument();
  expect(screen.getByText("전체 26개 · 1 / 2페이지")).toBeInTheDocument();

  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});

it("defaults Docker Hub to latest dates and resets pagination when changing date direction", async () => {
  const user = userEvent.setup();
  const requests: string[] = [];
  const lastUpdated = "2026-11-06T02:41:18.255Z";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (!url.pathname.endsWith("/tags"))
        return new Response(
          JSON.stringify({
            repository: {
              id: "hub-id",
              repository: "docker.io/library/node",
              createdAt: lastUpdated,
              favoriteCount: 0,
              official: true,
            },
          }),
        );
      requests.push(url.search);
      return new Response(
        JSON.stringify({
          tags: {
            count: 26,
            totalCount: 26,
            page: Number(url.searchParams.get("page")),
            pageSize: 25,
            repository: "docker.io/library/node",
            tags: [
              {
                name: "trixie",
                favorite: false,
                lastUpdated,
                platforms: ["linux/amd64", "linux/arm64/v8"],
              },
            ],
          },
        }),
      );
    }),
  );
  render(
    <ImageRepositoryDetailPage
      id="hub-id"
      isBusy={() => false}
      onCreateContainer={vi.fn()}
      onDownload={vi.fn()}
      onRepositoryChange={vi.fn()}
      refreshToken="initial"
      runtimeAvailable
    />,
  );
  expect(await screen.findByText("trixie")).toBeInTheDocument();
  expect(requests).toEqual(["?page=1&sort=-lastUpdated"]);
  expect(screen.getByRole("columnheader", { name: /갱신일/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  expect(document.querySelector(`time[datetime="${lastUpdated}"]`)).toBeInTheDocument();
  expect(screen.getByText("linux/arm64/v8")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "2페이지" }));
  await waitFor(() => expect(requests.at(-1)).toBe("?page=2&sort=-lastUpdated"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "갱신일 오름차순 정렬" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "갱신일 오름차순 정렬" }));
  await waitFor(() => expect(requests.at(-1)).toBe("?page=1&sort=lastUpdated"));
  expect(screen.getByRole("columnheader", { name: /갱신일/ })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await user.click(screen.getByRole("button", { name: "태그 오름차순 정렬" }));
  await waitFor(() => expect(requests.at(-1)).toBe("?page=1&sort=tag"));
  await user.click(screen.getByRole("button", { name: "갱신일 내림차순 정렬" }));
  await waitFor(() => expect(requests.at(-1)).toBe("?page=1&sort=-lastUpdated"));
});
