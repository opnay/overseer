import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RemoteComposeService,
  RemoteComposeStore,
  SafeRemoteComposeFetcher,
  deriveRemoteComposeProjectName,
  type RemoteComposeFetcher,
} from "../src/server/remote-compose.ts";
import type { CommandRunner } from "../src/server/lima-docker-runtime.ts";

const temporaryDirectories: string[] = [];

async function temporaryStore() {
  const directory = await mkdtemp(join(tmpdir(), "overseer-remote-compose-test-"));
  temporaryDirectories.push(directory);
  return {
    directory,
    store: new RemoteComposeStore({
      dataDirectory: directory,
      databasePath: join(directory, "overseer.sqlite"),
    }),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("SafeRemoteComposeFetcher", () => {
  it("accepts public HTTPS text and conditional 304 responses", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("services:\n  web:\n    image: nginx:alpine\n", {
          headers: { etag: '"v1"' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const fetcher = new SafeRemoteComposeFetcher(fetchImplementation, async () => [
      "93.184.216.34",
    ]);

    await expect(fetcher.fetch("https://example.com/compose.yaml")).resolves.toMatchObject({
      etag: '"v1"',
      status: "fetched",
    });
    await expect(
      fetcher.fetch("https://example.com/compose.yaml", { etag: '"v1"' }),
    ).resolves.toEqual({ status: "not-modified" });
    expect(fetchImplementation.mock.calls[1]?.[1]?.headers).toMatchObject({
      "if-none-match": '"v1"',
    });
  });

  it("rejects non-HTTPS and private network destinations including redirects", async () => {
    const fetchImplementation = vi.fn(async () =>
      Promise.resolve(
        new Response(null, {
          headers: { location: "https://127.0.0.1/compose.yaml" },
          status: 302,
        }),
      ),
    );
    const fetcher = new SafeRemoteComposeFetcher(fetchImplementation, async (hostname) =>
      hostname === "example.com" ? ["93.184.216.34"] : ["127.0.0.1"],
    );

    await expect(fetcher.fetch("http://example.com/compose.yaml")).rejects.toThrow("HTTPS");
    await expect(fetcher.fetch("https://127.0.0.1/compose.yaml")).rejects.toThrow("사설");
    await expect(fetcher.fetch("https://example.com/compose.yaml")).rejects.toThrow("사설");
  });

  it("rejects a response larger than one MiB", async () => {
    const fetcher = new SafeRemoteComposeFetcher(
      async () => new Response("large", { headers: { "content-length": String(1024 * 1024 + 1) } }),
      async () => ["93.184.216.34"],
    );
    await expect(fetcher.fetch("https://example.com/compose.yaml")).rejects.toThrow("1MiB");
  });
});

describe("RemoteComposeService", () => {
  it("stores, detects, applies, materializes, and removes a remote update", async () => {
    const { directory, store } = await temporaryStore();
    const first = "services:\n  web:\n    image: nginx:alpine\n";
    const second = "services:\n  web:\n    build:\n      context: .\n";
    const responses = [first, second];
    const fetcher: RemoteComposeFetcher = {
      fetch: vi.fn(async () => ({
        content: responses.shift() ?? second,
        status: "fetched" as const,
      })),
    };
    const service = new RemoteComposeService(vi.fn() as unknown as CommandRunner, {
      fetcher,
      store,
      validate: async (_name, content) => ({ buildContext: content.includes("build:") }),
    });

    const registered = await service.register(
      { url: "https://raw.githubusercontent.com/opnay/example/main/compose.yaml" },
      [],
    );
    expect(registered.name).toBe("example");
    expect(registered.buildContext).toBe(false);
    expect(await readFile(registered.configFile, "utf8")).toBe(first);

    await service.checkUpdate("example");
    expect((await service.get("example"))?.updateAvailable).toBe(true);
    await service.applyUpdate("example");
    const updated = await service.get("example");
    expect(updated).toMatchObject({ buildContext: true, updateAvailable: false });
    expect(await readFile(updated?.configFile ?? "", "utf8")).toBe(second);

    store.close();
    const reopened = new RemoteComposeStore({
      dataDirectory: directory,
      databasePath: join(directory, "overseer.sqlite"),
    });
    expect(reopened.get("example")?.buildContext).toBe(true);
    reopened.close();

    const removalStore = new RemoteComposeStore({
      dataDirectory: directory,
      databasePath: join(directory, "overseer.sqlite"),
    });
    const removalService = new RemoteComposeService(vi.fn() as unknown as CommandRunner, {
      fetcher,
      store: removalStore,
      validate: async () => ({ buildContext: false }),
    });
    await removalService.remove("example");
    expect(await removalService.get("example")).toBeUndefined();
    removalStore.close();
  });

  it("uses Docker Compose JSON config to detect build context", async () => {
    const { store } = await temporaryStore();
    const command: CommandRunner = vi.fn(async (_executable, args) => {
      expect(args).toEqual(
        expect.arrayContaining([
          "compose",
          "config",
          "--format",
          "json",
          "--no-interpolate",
          "--no-env-resolution",
          "--no-path-resolution",
        ]),
      );
      return {
        stderr: "",
        stdout: JSON.stringify({ services: { web: { build: { context: "." } } } }),
      };
    });
    const service = new RemoteComposeService(command, {
      fetcher: {
        fetch: async () => ({ content: "services:\n  web:\n    build: .\n", status: "fetched" }),
      },
      store,
    });

    await expect(
      service.register({ name: "build-project", url: "https://example.com/compose.yaml" }, []),
    ).resolves.toMatchObject({ buildContext: true });
    store.close();
  });

  it("derives stable names and rejects conflicts", async () => {
    expect(
      deriveRemoteComposeProjectName(
        "https://raw.githubusercontent.com/docker/awesome-compose/master/compose.yaml",
      ),
    ).toBe("awesome-compose");
    const { store } = await temporaryStore();
    const service = new RemoteComposeService(vi.fn() as unknown as CommandRunner, {
      fetcher: {
        fetch: async () => ({
          content: "services:\n  web:\n    image: nginx\n",
          status: "fetched",
        }),
      },
      store,
      validate: async () => ({ buildContext: false }),
    });
    await expect(
      service.register({ name: "existing", url: "https://example.com/compose.yaml" }, ["existing"]),
    ).rejects.toThrow("이미 실행 이력");
    store.close();
  });
});
