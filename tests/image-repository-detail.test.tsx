import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ImageRepositoryDetailPage } from "../src/client/pages/image-repositories/index.ts";

it("requests tag sorting and filtering, resets pages, and reloads favorites", async () => {
  const user = userEvent.setup();
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
              ? [{ favorite: false, name: favorite ? "v3" : "v2" }]
              : favorite
                ? [
                    { favorite: true, name: "v2" },
                    { favorite: false, name: "v9" },
                  ]
                : [
                    {
                      favorite: false,
                      name: url.searchParams.get("sort") === "-tag" ? "v9" : "v1",
                    },
                  ],
        },
      };
      if (url.searchParams.has("filter[tag]")) {
        response = {
          tags: {
            count: 0,
            totalCount: 26,
            page,
            pageSize: 25,
            repository: "ghcr.io/opnay/overseer",
            tags: [],
          },
        };
      }
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

  await user.click(screen.getByRole("button", { name: "2페이지" }));
  await screen.findByRole("button", { name: "v3 즐겨찾기 추가" });
  const search = screen.getByRole("searchbox", { name: "태그 검색" });
  const previousRequests = requests.length;
  await user.type(search, " v &+ ");
  expect(requests).toHaveLength(previousRequests);
  await user.keyboard("{Enter}");
  expect(await screen.findByText("검색 결과가 없습니다.")).toBeInTheDocument();
  let query = new URLSearchParams(requests.at(-1));
  expect(query.get("page")).toBe("1");
  expect(query.get("sort")).toBe("-tag");
  expect(query.get("filter[tag]")).toBe("v &+");
  await user.click(screen.getByRole("button", { name: "태그 오름차순 정렬" }));
  await waitFor(() => expect(new URLSearchParams(requests.at(-1)).get("sort")).toBe("tag"));
  expect(new URLSearchParams(requests.at(-1)).get("filter[tag]")).toBe("v &+");
  await user.click(screen.getByRole("button", { name: "태그 검색어 지우기" }));
  await screen.findByText("전체 26개 · 1 / 2페이지");
  query = new URLSearchParams(requests.at(-1));
  expect(query.has("filter[tag]")).toBe(false);
  expect(query.get("page")).toBe("1");
  expect(search).toHaveValue("");
});
