import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  PageHeaderSlotsProvider,
  PageHeaderSlotOutlet,
} from "../src/client/shared/ui/page-header-slots/index.ts";
import { BrowserRouter } from "react-router";
import { expect, it, vi } from "vitest";
import {
  ImageRepositoriesPage,
  ImageRepositoryDetailPage,
} from "../src/client/pages/image-repositories/index.ts";

function DetailTestShell({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter>
      <PageHeaderSlotsProvider>
        <PageHeaderSlotOutlet name="actions" />
        {children}
      </PageHeaderSlotsProvider>
    </BrowserRouter>
  );
}

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
    if (url.pathname.endsWith("/metadata")) return new Response(JSON.stringify({ metadata: {} }));
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
  window.history.replaceState(null, "", "/image-repositories/repository-id?section=tags");
  render(
    <DetailTestShell>
      <ImageRepositoryDetailPage
        id="repository-id"
        isBusy={() => false}
        onCreateContainer={vi.fn()}
        onDownload={vi.fn()}
        onRepositoryChange={vi.fn()}
        refreshToken="initial"
        runtimeAvailable
      />
    </DetailTestShell>,
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
      if (url.pathname.endsWith("/metadata")) return new Response(JSON.stringify({ metadata: {} }));
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
  window.history.replaceState(null, "", "/image-repositories/repository-id?section=tags");
  render(
    <DetailTestShell>
      <ImageRepositoryDetailPage
        id="hub-id"
        isBusy={() => false}
        onCreateContainer={vi.fn()}
        onDownload={vi.fn()}
        onRepositoryChange={vi.fn()}
        refreshToken="initial"
        runtimeAvailable
      />
    </DetailTestShell>,
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

it.each([
  ["docker.io/library/node", "https://hub.docker.com/_/node"],
  ["docker.io/opnay/overseer", "https://hub.docker.com/r/opnay/overseer"],
  ["ghcr.io/opnay/overseer", "https://github.com/users/opnay/packages/container/package/overseer"],
  ["quay.io/prometheus/prometheus", "https://quay.io/repository/prometheus/prometheus"],
])(
  "shows the original image page and saved favorites in the overview for %s",
  async (repository, href) => {
    const user = userEvent.setup();
    let favorites = ["archived", "stable"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PATCH") {
          favorites = favorites.filter((name) => name !== "archived");
          return new Response(JSON.stringify({ tag: { name: "archived", favorite: false } }));
        }
        if (url.includes("/tags?"))
          return new Response(
            JSON.stringify({
              tags: {
                count: 99,
                totalCount: 99,
                page: 1,
                pageSize: 25,
                repository,
                tags: [{ name: "latest", favorite: false }],
              },
            }),
          );
        return new Response(
          JSON.stringify({
            repository: {
              id: "overview",
              repository,
              createdAt: "2026-11-01T00:00:00Z",
              favoriteCount: favorites.length,
              favoriteTags: favorites,
            },
          }),
        );
      }),
    );
    window.history.replaceState(null, "", "/image-repositories/overview");
    render(
      <DetailTestShell>
        <ImageRepositoryDetailPage
          id="overview"
          isBusy={() => false}
          onCreateContainer={vi.fn()}
          onDownload={vi.fn()}
          onRepositoryChange={vi.fn()}
          refreshToken="initial"
          runtimeAvailable
        />
      </DetailTestShell>,
    );
    expect(
      await screen.findByRole("link", { name: `원본 이미지 페이지: ${repository}` }),
    ).toHaveAttribute("href", href);
    expect(await screen.findByText("99개")).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: `${repository} 태그 목록` }),
    ).not.toBeInTheDocument();
    const favoritesTable = screen.getByRole("list", { name: `${repository} 즐겨찾기 태그 목록` });
    expect(favoritesTable).toHaveTextContent("archived");
    await user.click(
      within(favoritesTable).getByRole("button", { name: "archived 즐겨찾기 해제" }),
    );
    await waitFor(() =>
      expect(within(favoritesTable).queryByText("archived")).not.toBeInTheDocument(),
    );
    expect(within(favoritesTable).getByText("stable")).toBeInTheDocument();
  },
);

it("disables new favorites at ten while allowing removals and recovery below the limit", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/metadata"))
        return new Response(JSON.stringify({ metadata: {} }));
      if (init?.method === "PATCH")
        return new Response(JSON.stringify({ tag: { name: "v0", favorite: false } }));
      if (String(input).includes("/tags?"))
        return new Response(
          JSON.stringify({
            tags: {
              count: 11,
              totalCount: 11,
              page: 1,
              pageSize: 25,
              repository: "docker.io/library/node",
              tags: [
                { name: "v0", favorite: true },
                { name: "new", favorite: false },
              ],
            },
          }),
        );
      return new Response(
        JSON.stringify({
          repository: {
            id: "limited",
            repository: "docker.io/library/node",
            createdAt: "2026-11-01T00:00:00Z",
            favoriteCount: 10,
            favoriteTags: Array.from({ length: 10 }, (_, i) => `v${i}`),
          },
        }),
      );
    }),
  );
  window.history.replaceState(null, "", "/image-repositories/limited?section=tags");
  render(
    <DetailTestShell>
      <ImageRepositoryDetailPage
        id="limited"
        isBusy={() => false}
        onCreateContainer={vi.fn()}
        onDownload={vi.fn()}
        onRepositoryChange={vi.fn()}
        refreshToken="initial"
        runtimeAvailable
      />
    </DetailTestShell>,
  );
  expect(await screen.findByRole("button", { name: "new 즐겨찾기 추가" })).toBeDisabled();
  const remove = screen.getByRole("button", { name: "v0 즐겨찾기 해제" });
  expect(remove).toBeEnabled();
  await user.click(remove);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "new 즐겨찾기 추가" })).toBeEnabled(),
  );
});

it("loads description metadata independently, retries, and reads Markdown in a large panel", async () => {
  const user = userEvent.setup();
  const onRepositoryChange = vi.fn();
  let metadataFailed = true;
  const markdown =
    '# Getting started\n\nRun `docker run node`.\n\n| Tag | Type |\n| --- | --- |\n| stable | image |\n\n[Documentation](https://example.com/docs)\n\n<script>alert(\'unsafe\')</script>\n\n![Node logo](https://example.com/logo.png)\n\n<img src="https://example.com/badge.svg" alt="Build status" onerror="alert(1)" />';
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/metadata"))
        return metadataFailed
          ? new Response(JSON.stringify({ error: { message: "Docker Hub 일시 오류" } }), {
              status: 503,
            })
          : new Response(
              JSON.stringify({
                metadata: {
                  description: "Node image description",
                  fullDescription: markdown,
                  lastUpdated: "2026-11-06T02:41:19Z",
                },
              }),
            );
      if (url.includes("/tags?"))
        return new Response(
          JSON.stringify({
            tags: {
              count: 1,
              totalCount: 1,
              page: 1,
              pageSize: 25,
              repository: "docker.io/library/node",
              tags: [{ name: "stable", favorite: true }],
            },
          }),
        );
      return new Response(
        JSON.stringify({
          repository: {
            id: "readme-id",
            repository: "docker.io/library/node",
            createdAt: "2026-11-01T00:00:00Z",
            favoriteCount: 1,
            favoriteTags: ["stable"],
          },
        }),
      );
    }),
  );
  window.history.replaceState(null, "", "/image-repositories/readme-id");
  render(
    <DetailTestShell>
      <ImageRepositoryDetailPage
        id="readme-id"
        isBusy={() => false}
        onCreateContainer={vi.fn()}
        onDownload={vi.fn()}
        onRepositoryChange={onRepositoryChange}
        refreshToken="initial"
        runtimeAvailable
      />
    </DetailTestShell>,
  );
  expect(await screen.findByText("저장소 설명을 불러오지 못했습니다.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "stable 즐겨찾기 해제" })).toBeEnabled();
  metadataFailed = false;
  await user.click(screen.getByRole("button", { name: "설명 다시 불러오기" }));
  const open = await screen.findByRole("button", { name: "상세 설명 열기" });
  await waitFor(() =>
    expect(onRepositoryChange).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Node image description" }),
    ),
  );
  expect(document.querySelector('time[datetime="2026-11-06T02:41:19Z"]')).toBeInTheDocument();
  await user.click(open);
  const dialog = await screen.findByRole(
    "dialog",
    { name: "docker.io/library/node 상세 설명" },
    { timeout: 5_000 },
  );
  expect(within(dialog).getByRole("heading", { name: "Getting started" })).toBeInTheDocument();
  expect(within(dialog).getByRole("table")).toHaveTextContent("stable");
  expect(within(dialog).getByRole("link", { name: "Documentation" })).toHaveAttribute(
    "target",
    "_blank",
  );
  expect(dialog.querySelector("script")).toBeNull();
  expect(within(dialog).getByRole("img", { name: "Node logo" })).toHaveAttribute(
    "src",
    "https://example.com/logo.png",
  );
  const htmlImage = within(dialog).getByRole("img", { name: "Build status" });
  expect(htmlImage).toHaveAttribute("src", "https://example.com/badge.svg");
  expect(htmlImage).not.toHaveAttribute("onerror");
  expect(
    within(dialog).getByRole("link", { name: "Documentation" }).querySelector("svg"),
  ).toBeInTheDocument();
  expect(dialog.querySelector("p > code")).toHaveTextContent("docker run node");
  await user.click(within(dialog).getByRole("button", { name: "상세 설명 닫기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
