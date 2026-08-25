import { describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { emptyContainerSpec } from "../src/shared/container-spec.ts";
import { LimaDockerRuntime, type CommandRunner } from "../src/server/lima-docker-runtime.ts";
import { CommandError } from "../src/server/process.ts";
import type { BuilderComposeRegistry } from "../src/server/builder-compose.ts";
import type { RemoteComposeRegistry } from "../src/server/remote-compose.ts";

const limaRow = "overseer\tRunning\t/tmp/overseer\n";

function limaDetails(
  overrides: Partial<{
    cpus: number;
    dir: string;
    disk: number;
    memory: number;
    status: string;
    vmType: string;
    writable: boolean;
  }> = {},
) {
  const values = {
    cpus: 4,
    dir: "/tmp/overseer",
    disk: 100 * 1024 ** 3,
    memory: 4 * 1024 ** 3,
    status: "Running",
    vmType: "vz",
    writable: true,
    ...overrides,
  };
  return JSON.stringify({
    ...values,
    config: {
      mounts: [
        {
          location: homedir(),
          mountPoint: homedir(),
          writable: values.writable,
        },
      ],
    },
    name: "overseer",
  });
}

function commandFailure(command: string, stderr: string) {
  return new CommandError(command, Object.assign(new Error("command failed"), { code: 1 }), stderr);
}

function dockerContextResponder(initialEndpoint?: string) {
  let activeContext = initialEndpoint ? "overseer" : "default";
  let contextEndpoint = initialEndpoint;
  return async (args: readonly string[]) => {
    if (args[0] === "context" && args[1] === "show") {
      return { stderr: "", stdout: `${activeContext}\n` };
    }
    if (args[0] === "context" && args[1] === "inspect") {
      if (!contextEndpoint) {
        throw commandFailure("docker context inspect", 'context "overseer": context not found');
      }
      return { stderr: "", stdout: `${contextEndpoint}\n` };
    }
    if (args[0] === "context" && (args[1] === "create" || args[1] === "update")) {
      contextEndpoint = args.find((value) => value.startsWith("host="))?.slice("host=".length);
      return { stderr: "", stdout: "" };
    }
    if (args[0] === "context" && args[1] === "use") {
      activeContext = args[2] ?? activeContext;
      return { stderr: "", stdout: `${activeContext}\n` };
    }
    return { stderr: "", stdout: "29.7.2\n" };
  };
}

const dockerEngineConfiguration = {
  cpus: 4,
  diskGiB: 100,
  memoryGiB: 4,
  provider: "lima" as const,
  vmType: "vz" as const,
};

function emptyBuilderRegistry(): BuilderComposeRegistry {
  return {
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    register: vi.fn(async () => {
      throw new Error("unused");
    }),
    remove: vi.fn(async () => undefined),
    update: vi.fn(async () => {
      throw new Error("unused");
    }),
  };
}

function inspectFixture() {
  return {
    Config: {
      Cmd: ["sleep", "600"],
      Env: ["MODE=test"],
      Hostname: "old-id-12345",
      Image: "alpine:3.22",
      Labels: {
        "com.opnay.overseer.managed": "true",
        "com.opnay.overseer.spec-version": "1",
        team: "platform",
      },
    },
    HostConfig: {
      CapAdd: null,
      CapDrop: null,
      Devices: [],
      Memory: 134_217_728,
      NanoCpus: 500_000_000,
      NetworkMode: "bridge",
      PortBindings: {
        "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "18080" }],
      },
      Privileged: false,
      RestartPolicy: { MaximumRetryCount: 3, Name: "on-failure" },
      SecurityOpt: null,
    },
    Id: "old-id-1234567890",
    Mounts: [
      {
        Destination: "/data",
        Name: "audit-data",
        RW: true,
        Source: "/var/lib/docker/volumes/audit-data/_data",
        Type: "volume",
      },
    ],
    Name: "/web",
    NetworkSettings: { Networks: { bridge: {} } },
    State: { Running: true },
  };
}

describe("LimaDockerRuntime optional Compose capability", () => {
  it("keeps the Docker dashboard available when the host Compose plugin is missing", async () => {
    const dockerCommands: string[][] = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable === "limactl") return { stderr: "", stdout: limaRow };
      if (args[0] === "compose" && args[1] === "version") {
        throw commandFailure("docker compose version", "compose is not a docker command");
      }
      dockerCommands.push([...args]);
      if (args.includes("version")) return { stderr: "", stdout: "29.7.2\n" };
      return { stderr: "", stdout: "[]" };
    });
    const runtime = new LimaDockerRuntime(command);

    await expect(runtime.getDashboard()).resolves.toMatchObject({
      capabilities: { dockerCompose: false },
      composeProjects: [],
      runtime: { phase: "running" },
    });
    expect(dockerCommands.some((args) => args.includes("compose"))).toBe(false);
  });
});

describe("LimaDockerRuntime image inspection", () => {
  it("builds canonical image URLs and maps Docker inspect details", async () => {
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable === "limactl") return { stderr: "", stdout: limaRow };
      const dockerArgs = args.slice(2);
      if (dockerArgs[0] === "image" && dockerArgs[1] === "ls") {
        return {
          stderr: "",
          stdout: `${JSON.stringify({
            CreatedAt: "2026-08-22 18:22:08 +0900 KST",
            CreatedSince: "2 days ago",
            ID: "3e24e96c89ef",
            Repository: "louislam/uptime-kuma",
            Size: "2.51GB",
            Tag: "2",
          })}\n`,
        };
      }
      if (dockerArgs[0] === "image" && dockerArgs[1] === "inspect") {
        return {
          stderr: "",
          stdout: JSON.stringify([
            {
              Architecture: "arm64",
              Comment: "buildkit.dockerfile.v0",
              Config: {
                Cmd: ["node", "server/server.js"],
                Entrypoint: ["/usr/bin/dumb-init", "--"],
                Env: ["NODE_ENV=production"],
                ExposedPorts: { "3001/tcp": {} },
                Labels: {
                  "org.opencontainers.image.source": "https://github.com/louislam/uptime-kuma",
                },
                WorkingDir: "/app",
              },
              Created: "2026-08-22T09:22:08.000Z",
              Id: "sha256:3e24e96c89ef",
              Os: "linux",
              RepoDigests: ["louislam/uptime-kuma@sha256:digest"],
              RepoTags: ["louislam/uptime-kuma:2"],
              RootFS: { Layers: ["sha256:layer-one", "sha256:layer-two"] },
              Size: 601_204_055,
            },
          ]),
        };
      }
      if (dockerArgs[0] === "image" && dockerArgs[1] === "history") {
        return {
          stderr: "",
          stdout: `${JSON.stringify({
            Comment: "buildkit.dockerfile.v0",
            CreatedAt: "2026-08-22T18:22:08+09:00",
            CreatedBy: 'CMD ["node" "server/server.js"]',
            CreatedSince: "2 days ago",
            ID: "sha256:3e24e96c89ef",
            Size: "0B",
          })}\n`,
        };
      }
      throw new Error(`unexpected Docker command: ${dockerArgs.join(" ")}`);
    });
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            count: 1,
            results: [
              {
                full_size: 601_000_000,
                images: [
                  { architecture: "amd64", os: "linux", variant: null },
                  { architecture: "arm64", os: "linux", variant: null },
                ],
                last_updated: "2026-08-24T02:32:04.000Z",
                name: "latest",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const runtime = new LimaDockerRuntime(command, undefined, undefined, fetcher);

    await expect(runtime.getImages()).resolves.toEqual([
      {
        createdAt: "2026-08-22 18:22:08 +0900 KST",
        createdSince: "2 days ago",
        id: "3e24e96c89ef",
        platform: "linux/arm64",
        repository: "louislam/uptime-kuma",
        size: "2.51GB",
        tag: "2",
        url: "docker.io/louislam/uptime-kuma:2",
      },
    ]);
    await expect(runtime.getImage("3e24e96c89ef")).resolves.toMatchObject({
      architecture: "arm64",
      command: ["node", "server/server.js"],
      entrypoint: ["/usr/bin/dumb-init", "--"],
      environment: [{ key: "NODE_ENV", value: "production" }],
      exposedPorts: ["3001/tcp"],
      labels: [
        {
          key: "org.opencontainers.image.source",
          value: "https://github.com/louislam/uptime-kuma",
        },
      ],
      layers: ["sha256:layer-one", "sha256:layer-two"],
      operatingSystem: "linux",
      repositoryTags: ["louislam/uptime-kuma:2"],
      workingDirectory: "/app",
    });
    await expect(runtime.getImageHistory("3e24e96c89ef")).resolves.toEqual([
      {
        comment: "buildkit.dockerfile.v0",
        createdAt: "2026-08-22T18:22:08+09:00",
        createdBy: 'CMD ["node" "server/server.js"]',
        createdSince: "2 days ago",
        id: "sha256:3e24e96c89ef",
        size: "0B",
      },
    ]);
    await expect(runtime.getImageRepositoryTags("3e24e96c89ef", 2)).resolves.toEqual({
      count: 1,
      page: 2,
      pageSize: 25,
      repository: "louislam/uptime-kuma",
      tags: [
        {
          lastUpdated: "2026-08-24T02:32:04.000Z",
          name: "latest",
          platforms: ["linux/amd64", "linux/arm64"],
          sizeBytes: 601_000_000,
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        "https://hub.docker.com/v2/namespaces/louislam/repositories/uptime-kuma/tags?ordering=last_updated&page=2&page_size=25",
      ),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not fetch tag lists from non-Docker Hub registries", async () => {
    const command: CommandRunner = vi.fn(async (executable) => {
      if (executable === "limactl") return { stderr: "", stdout: limaRow };
      return {
        stderr: "",
        stdout: JSON.stringify([
          {
            Architecture: "arm64",
            Created: "2026-08-22T09:22:08.000Z",
            Id: "sha256:3e24e96c89ef",
            Os: "linux",
            RepoTags: ["registry.internal/team/app:latest"],
            Size: 1_000,
          },
        ]),
      };
    });
    const fetcher: typeof fetch = vi.fn();
    const runtime = new LimaDockerRuntime(command, undefined, undefined, fetcher);

    await expect(runtime.getImageRepositoryTags("3e24e96c89ef", 1)).rejects.toThrow(
      "공개 Docker Hub 저장소",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("LimaDockerRuntime container configuration", () => {
  it("returns full inspect JSON and newest-first sanitized Health Check history", async () => {
    const inspected = {
      ...inspectFixture(),
      State: {
        Health: {
          FailingStreak: 2,
          Log: [
            {
              End: "2026-08-25T01:00:01.000000000+09:00",
              ExitCode: 0,
              Output: "older check\n",
              Start: "2026-08-25T01:00:00.000000000+09:00",
            },
            {
              End: "2026-08-25T01:01:01.000000000+09:00",
              ExitCode: 1,
              Output: `\u001b[31mfailed\u001b[0m${"x".repeat(8_100)}`,
              Start: "2026-08-25T01:01:00.000000000+09:00",
            },
          ],
          Status: "unhealthy",
        },
        Running: true,
      },
    };
    const command: CommandRunner = vi.fn(async (executable) =>
      executable === "limactl"
        ? { stderr: "", stdout: limaRow }
        : { stderr: "", stdout: JSON.stringify([inspected]) },
    );
    const runtime = new LimaDockerRuntime(command);

    const inspection = await runtime.getContainerInspection(inspected.Id);

    expect(inspection.json).toContain('"Status": "unhealthy"');
    expect(inspection.health).toMatchObject({
      failingStreak: 2,
      history: [
        {
          exitCode: 1,
          output: expect.stringMatching(/^failedx+\n… 출력이 잘렸습니다\.$/),
          startedAt: "2026-08-25T01:01:00.000000000+09:00",
        },
        { exitCode: 0, output: "older check" },
      ],
      status: "unhealthy",
    });
  });

  it("separates observed bind mounts from editable named volumes", async () => {
    const inspected = {
      ...inspectFixture(),
      Mounts: [
        ...inspectFixture().Mounts,
        {
          Destination: "/app/data",
          RW: false,
          Source: "/home/test.guest/.local/share/overseer/compose/demo/data",
          Type: "bind",
        },
      ],
    };
    const command: CommandRunner = vi.fn(async (executable) =>
      executable === "limactl"
        ? { stderr: "", stdout: limaRow }
        : { stderr: "", stdout: JSON.stringify([inspected]) },
    );
    const runtime = new LimaDockerRuntime(command);

    const detail = await runtime.getContainer(inspected.Id);

    expect(detail.spec.volumes).toEqual([
      { containerPath: "/data", readOnly: false, volume: "audit-data" },
    ]);
    expect(detail.mounts).toEqual([
      {
        containerPath: "/app/data",
        hostPath: "/home/test.guest/.local/share/overseer/compose/demo/data",
        readOnly: true,
        type: "bind",
      },
      { containerPath: "/data", readOnly: false, type: "volume", volume: "audit-data" },
    ]);
    expect(detail.replacementBlockers).toContain("named volume 이외의 마운트가 있습니다.");
  });

  it("passes the supported create options without a shell", async () => {
    const dockerCommands: string[][] = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable === "limactl") return { stderr: "", stdout: limaRow };
      const dockerArgs = args.slice(2);
      dockerCommands.push(dockerArgs);
      return {
        stderr: "",
        stdout: dockerArgs[1] === "create" ? "new-id\n" : "",
      };
    });
    const runtime = new LimaDockerRuntime(command);
    await runtime.runContainer({
      ...emptyContainerSpec(),
      command: ["sh", "-c", "echo ready"],
      environment: [{ key: "MODE", value: "audit" }],
      hostname: "audit.local",
      image: "alpine:3.23",
      labels: [{ key: "team", value: "platform" }],
      name: "audit-web",
      networks: ["audit-primary", "audit-secondary"],
      ports: [{ containerPort: 8080, hostPort: 18080, protocol: "tcp" }],
      pullPolicy: "always",
      resources: { cpus: 0.5, memoryMiB: 128 },
      restartPolicy: { mode: "on-failure", maximumRetryCount: 3 },
      volumes: [{ containerPath: "/data", readOnly: true, volume: "audit-data" }],
    });

    const create = dockerCommands.find(
      ([first, second]) => first === "container" && second === "create",
    );
    expect(create).toEqual(
      expect.arrayContaining([
        "--pull",
        "always",
        "--name",
        "audit-web",
        "--hostname",
        "audit.local",
        "--env",
        "MODE=audit",
        "--publish",
        "127.0.0.1:18080:8080/tcp",
        "--network",
        "audit-primary",
        "--restart",
        "on-failure:3",
        "--cpus",
        "0.5",
        "--memory",
        "128m",
        "alpine:3.23",
        "sh",
        "-c",
        "echo ready",
      ]),
    );
    expect(create?.join(" ")).toContain("type=volume,source=audit-data,target=/data,readonly");
    expect(dockerCommands).toContainEqual(["network", "connect", "audit-secondary", "new-id"]);
    expect(dockerCommands).toContainEqual(["container", "start", "new-id"]);
  });

  it("rolls back the original container when replacement start fails", async () => {
    const dockerCommands: string[][] = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable === "limactl") return { stderr: "", stdout: limaRow };
      const dockerArgs = args.slice(2);
      dockerCommands.push(dockerArgs);
      if (dockerArgs[0] === "container" && dockerArgs[1] === "inspect") {
        return { stderr: "", stdout: JSON.stringify([inspectFixture()]) };
      }
      if (dockerArgs[0] === "container" && dockerArgs[1] === "create") {
        return { stderr: "", stdout: "new-id\n" };
      }
      if (
        dockerArgs[0] === "container" &&
        dockerArgs[1] === "start" &&
        dockerArgs[2] === "new-id"
      ) {
        throw new CommandError(
          "docker container start new-id",
          Object.assign(new Error("start failed"), { code: 1 }),
          "start failed",
        );
      }
      return { stderr: "", stdout: "" };
    });
    const runtime = new LimaDockerRuntime(command);
    const detail = await runtime.getContainer("old-id-1234567890");
    const desired = { ...detail.spec, image: "alpine:3.23" };

    await expect(
      runtime.updateContainer("old-id-1234567890", {
        expectedConfigHash: detail.configHash,
        spec: desired,
      }),
    ).rejects.toThrow("start failed");

    const replacementCommands = dockerCommands.slice(2);
    expect(replacementCommands).toEqual(
      expect.arrayContaining([
        ["container", "stop", "old-id-1234567890"],
        ["container", "start", "new-id"],
        ["container", "rm", "--force", "new-id"],
        ["container", "rename", "old-id-1234567890", "web"],
        ["container", "start", "old-id-1234567890"],
      ]),
    );
    expect(
      replacementCommands.some(
        ([first, second, id]) =>
          first === "container" && second === "rm" && id === "old-id-1234567890",
      ),
    ).toBe(false);
  });

  it("rejects a stale config hash before changing the container", async () => {
    const dockerCommands: string[][] = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable === "limactl") return { stderr: "", stdout: limaRow };
      const dockerArgs = args.slice(2);
      dockerCommands.push(dockerArgs);
      return { stderr: "", stdout: JSON.stringify([inspectFixture()]) };
    });
    const runtime = new LimaDockerRuntime(command);
    await expect(
      runtime.updateContainer("old-id-1234567890", {
        expectedConfigHash: "b".repeat(64),
        spec: { ...emptyContainerSpec(), image: "alpine:3.23", name: "web" },
      }),
    ).rejects.toThrow("다시 불러온 뒤");
    expect(
      dockerCommands.filter(([first, second]) => first === "container" && second !== "inspect"),
    ).toHaveLength(0);
  });
});

describe("LimaDockerRuntime remote Compose", () => {
  it("lists a build project but blocks its up action before Docker Compose", async () => {
    const dockerCommands: string[][] = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable === "limactl") return { stderr: "", stdout: limaRow };
      const dockerArgs = args.slice(2);
      dockerCommands.push(dockerArgs);
      if (dockerArgs[0] === "compose" && dockerArgs[1] === "ls") {
        return { stderr: "", stdout: "[]" };
      }
      return { stderr: "", stdout: "" };
    });
    const registry: RemoteComposeRegistry = {
      applyUpdate: vi.fn(async () => undefined),
      checkUpdate: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
      list: vi.fn(async () => [
        {
          buildContext: true,
          checkedAt: "2026-08-23T00:00:00.000Z",
          configFile: "/tmp/remote-build/compose.yaml",
          contentHash: "a".repeat(64),
          name: "remote-build",
          updateAvailable: false,
          url: "https://example.com/compose.yaml",
        },
      ]),
      register: vi.fn(async () => {
        throw new Error("unused");
      }),
      remove: vi.fn(async () => undefined),
    };
    const runtime = new LimaDockerRuntime(command, registry, emptyBuilderRegistry());

    await expect(runtime.getComposeProjects()).resolves.toMatchObject([
      {
        name: "remote-build",
        remote: { buildContext: true },
        status: "blocked",
      },
    ]);
    await expect(runtime.composeProjectAction("remote-build", "up")).rejects.toThrow(
      "build context",
    );
    expect(dockerCommands.some((args) => args.includes("up"))).toBe(false);
  });

  it("runs a remote project with the macOS Docker CLI and materialized host file", async () => {
    const commands: Array<{ args: readonly string[]; executable: string }> = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      commands.push({ args, executable });
      if (executable === "limactl" && args[0] === "list") {
        return { stderr: "", stdout: limaRow };
      }
      if (executable === "docker") return { stderr: "", stdout: "[]" };
      return { stderr: "", stdout: "" };
    });
    const registry: RemoteComposeRegistry = {
      applyUpdate: vi.fn(async () => undefined),
      checkUpdate: vi.fn(async () => undefined),
      get: vi.fn(async () => ({
        buildContext: false,
        checkedAt: "2026-08-23T00:00:00.000Z",
        configFile: "/host/compose/remote-stack/compose.yaml",
        content: "services: {}\n",
        contentHash: "a".repeat(64),
        name: "remote-stack",
        pendingContent: "services:\n  web:\n    image: nginx\n",
        pendingHash: "b".repeat(64),
        updateAvailable: true,
        url: "https://example.com/compose.yaml",
      })),
      list: vi.fn(async () => [
        {
          buildContext: false,
          checkedAt: "2026-08-23T00:00:00.000Z",
          configFile: "/host/compose/remote-stack/compose.yaml",
          contentHash: "a".repeat(64),
          name: "remote-stack",
          updateAvailable: false,
          url: "https://example.com/compose.yaml",
        },
      ]),
      register: vi.fn(async () => {
        throw new Error("unused");
      }),
      remove: vi.fn(async () => undefined),
    };
    const runtime = new LimaDockerRuntime(command, registry, emptyBuilderRegistry());

    await expect(runtime.getComposeProject("remote-stack")).resolves.toMatchObject({
      configuration: {
        contentHash: "a".repeat(64),
        kind: "remote",
        pendingHash: "b".repeat(64),
        pendingYaml: expect.stringContaining("image: nginx"),
        yaml: "services: {}\n",
      },
    });
    await runtime.composeProjectAction("remote-stack", "up");

    expect(commands).toContainEqual({
      args: [
        "--host",
        "unix:///tmp/overseer/sock/docker.sock",
        "compose",
        "--project-name",
        "remote-stack",
        "--file",
        "/host/compose/remote-stack/compose.yaml",
        "up",
        "--detach",
      ],
      executable: "docker",
    });
    expect(
      commands.some(
        ({ args, executable }) =>
          executable === "limactl" && (args.includes("copy") || args.includes("shell")),
      ),
    ).toBe(false);
  });

  it("uses only the final diagnostic line as an unknown Docker error message", async () => {
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable === "limactl") return { stderr: "", stdout: limaRow };
      const dockerArgs = args.slice(2);
      if (dockerArgs[0] === "compose" && dockerArgs[1] === "ls") {
        return {
          stderr: "",
          stdout: JSON.stringify([
            {
              ConfigFiles: "/tmp/compose.yaml",
              Name: "remote-stack",
              Status: "exited(1)",
            },
          ]),
        };
      }
      throw new CommandError(
        "docker compose up",
        Object.assign(new Error("failed"), { code: 1 }),
        "Image example Pulling\nlayer Downloading 400MB\nError response from daemon: read-only file system\n",
      );
    });
    const registry: RemoteComposeRegistry = {
      applyUpdate: vi.fn(async () => undefined),
      checkUpdate: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      register: vi.fn(async () => {
        throw new Error("unused");
      }),
      remove: vi.fn(async () => undefined),
    };
    const runtime = new LimaDockerRuntime(command, registry, emptyBuilderRegistry());

    await expect(runtime.composeProjectAction("remote-stack", "up")).rejects.toMatchObject({
      message: "Error response from daemon: read-only file system",
    });
  });
});

describe("LimaDockerRuntime form Compose", () => {
  it("lists a persisted form project and runs its host materialized file", async () => {
    const commands: Array<{ args: readonly string[]; executable: string }> = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      commands.push({ args, executable });
      if (executable === "limactl" && args[0] === "list") return { stderr: "", stdout: limaRow };
      if (executable === "docker") return { stderr: "", stdout: "[]" };
      return { stderr: "", stdout: "" };
    });
    const remote: RemoteComposeRegistry = {
      applyUpdate: vi.fn(async () => undefined),
      checkUpdate: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      register: vi.fn(async () => {
        throw new Error("unused");
      }),
      remove: vi.fn(async () => undefined),
    };
    const builder: BuilderComposeRegistry = {
      get: vi.fn(async () => ({
        configFile: "/host/compose/form-stack/compose.yaml",
        configHash: "a".repeat(64),
        name: "form-stack",
        spec: { name: "form-stack", networks: [], services: [], volumes: [] },
        yaml: "services: {}\n",
      })),
      list: vi.fn(async () => [
        {
          configFile: "/host/compose/form-stack/compose.yaml",
          configHash: "a".repeat(64),
          name: "form-stack",
          spec: { name: "form-stack", networks: [], services: [], volumes: [] },
          yaml: "services: {}\n",
        },
      ]),
      register: vi.fn(async () => {
        throw new Error("unused");
      }),
      remove: vi.fn(async () => undefined),
      update: vi.fn(async () => {
        throw new Error("unused");
      }),
    };
    const runtime = new LimaDockerRuntime(command, remote, builder);

    await expect(runtime.getComposeProjects()).resolves.toMatchObject([
      { builder: { configHash: "a".repeat(64) }, name: "form-stack", status: "registered" },
    ]);
    await expect(runtime.getComposeProject("form-stack")).resolves.toMatchObject({
      configuration: {
        configHash: "a".repeat(64),
        kind: "builder",
        yaml: "services: {}\n",
      },
    });
    await runtime.composeProjectAction("form-stack", "up");
    expect(commands).toContainEqual({
      args: [
        "--host",
        "unix:///tmp/overseer/sock/docker.sock",
        "compose",
        "--project-name",
        "form-stack",
        "--file",
        "/host/compose/form-stack/compose.yaml",
        "up",
        "--detach",
      ],
      executable: "docker",
    });
  });
});

describe("LimaDockerRuntime Docker Engine configuration", () => {
  it("returns defaults and reports a missing QEMU dependency", async () => {
    const command: CommandRunner = vi.fn(async (executable) => {
      if (executable === "limactl") {
        throw commandFailure("limactl list", "No instance matching overseer found.");
      }
      throw commandFailure(executable, "command not found");
    });
    const runtime = new LimaDockerRuntime(command);

    await expect(runtime.getDockerEngineConfiguration()).resolves.toMatchObject({
      configuration: dockerEngineConfiguration,
      source: "default",
      vmTypes: [
        { available: true, value: "vz" },
        { available: false, unavailableReason: expect.stringContaining("brew install qemu") },
      ],
    });
  });

  it("maps the current Lima JSON configuration", async () => {
    const docker = dockerContextResponder("unix:///tmp/overseer/sock/docker.sock");
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable.startsWith("qemu-system-")) {
        return { stderr: "", stdout: "QEMU emulator version 10.1.0\n" };
      }
      if (executable === "docker") return docker(args);
      expect(args).toEqual(["list", "overseer", "--json"]);
      return {
        stderr: "",
        stdout: limaDetails({
          cpus: 6,
          disk: 120 * 1024 ** 3,
          memory: 8 * 1024 ** 3,
          vmType: "qemu",
        }),
      };
    });
    const runtime = new LimaDockerRuntime(command);

    await expect(runtime.getDockerEngineConfiguration()).resolves.toMatchObject({
      configuration: {
        cpus: 6,
        diskGiB: 120,
        memoryGiB: 8,
        provider: "lima",
        vmType: "qemu",
      },
      dockerCli: { homeMountWritable: true, ready: true },
      source: "instance",
      vmTypes: [{ value: "vz" }, { available: true, value: "qemu" }],
    });
  });

  it("reads managed and additional settings from the rootless daemon file", async () => {
    const command: CommandRunner = vi.fn(async (executable, args) => {
      expect(executable).toBe("limactl");
      if (args[0] === "list") return { stderr: "", stdout: limaRow };
      return {
        stderr: "",
        stdout:
          'file\n{"features":{"containerd-snapshotter":true},"live-restore":true,"log-driver":"local","log-opts":{"max-size":"10m","max-file":"3","mode":"non-blocking"},"dns":["1.1.1.1"]}\n',
      };
    });
    const runtime = new LimaDockerRuntime(command);

    await expect(runtime.getDockerDaemonConfiguration()).resolves.toMatchObject({
      additionalJson: expect.stringMatching(/containerd-snapshotter[\s\S]+non-blocking/),
      available: true,
      configuration: {
        dns: ["1.1.1.1"],
        liveRestore: true,
        logDriver: "local",
        logMaxFile: 3,
        logMaxSize: "10m",
      },
      source: "file",
    });
  });

  it("validates, writes, and restarts only the Docker daemon", async () => {
    const written: string[] = [];
    const commands: Array<{ args: readonly string[]; executable: string }> = [];
    const command: CommandRunner = vi.fn(async (executable, args, options) => {
      commands.push({ args, executable });
      if (executable === "docker") return { stderr: "", stdout: "29.7.2\n" };
      if (args[0] === "list") return { stderr: "", stdout: limaRow };
      if (args.includes("systemctl")) return { stderr: "", stdout: "" };
      if (args[0] === "shell" && args.at(-1)?.includes("dockerd --validate")) {
        written.push(options.input ?? "");
        return { stderr: "", stdout: "configuration OK\n" };
      }
      return {
        stderr: "",
        stdout: 'file\n{"features":{"containerd-snapshotter":true}}\n',
      };
    });
    const runtime = new LimaDockerRuntime(command);

    await runtime.applyDockerDaemonConfiguration({
      additionalJson:
        '{"features":{"containerd-snapshotter":true},"log-opts":{"mode":"non-blocking"}}',
      configuration: {
        debug: false,
        defaultAddressPools: [{ base: "172.30.0.0/16", size: 24 }],
        dns: ["1.1.1.1"],
        insecureRegistries: [],
        liveRestore: true,
        logDriver: "local",
        logMaxFile: 3,
        logMaxSize: "10m",
        maxConcurrentDownloads: 3,
        maxConcurrentUploads: 5,
        proxies: { noProxy: [] },
        registryMirrors: [],
      },
    });

    expect(JSON.parse(written[0] ?? "{}")).toMatchObject({
      features: { "containerd-snapshotter": true },
      "live-restore": true,
      "log-driver": "local",
      "log-opts": { "max-file": "3", "max-size": "10m", mode: "non-blocking" },
    });
    expect(commands).toContainEqual({
      args: ["shell", "overseer", "systemctl", "--user", "restart", "docker"],
      executable: "limactl",
    });
    expect(commands.some(({ args }) => args[0] === "delete" || args[0] === "stop")).toBe(false);
  });

  it("merges one section into the latest daemon file without overwriting other sections", async () => {
    const original = JSON.stringify({
      features: { "containerd-snapshotter": true },
      "live-restore": true,
      "log-driver": "local",
      dns: ["1.1.1.1"],
      proxies: { "no-proxy": "localhost" },
      "registry-mirrors": ["https://mirror.example.com"],
    });
    const written: string[] = [];
    const command: CommandRunner = vi.fn(async (executable, args, options) => {
      if (executable === "docker") return { stderr: "", stdout: "29.7.2\n" };
      if (args[0] === "list") return { stderr: "", stdout: limaRow };
      if (args.includes("systemctl")) return { stderr: "", stdout: "" };
      if (args[0] === "shell" && args.at(-1)?.includes("dockerd --validate")) {
        written.push(options.input ?? "");
        return { stderr: "", stdout: "configuration OK\n" };
      }
      return { stderr: "", stdout: `file\n${original}\n` };
    });
    const runtime = new LimaDockerRuntime(command);

    await runtime.applyDockerDaemonConfigurationSection({
      configuration: {
        defaultAddressPools: [{ base: "172.31.0.0/16", size: 24 }],
        dns: ["8.8.8.8"],
      },
      section: "network",
    });

    expect(JSON.parse(written[0] ?? "{}")).toMatchObject({
      "default-address-pools": [{ base: "172.31.0.0/16", size: 24 }],
      dns: ["8.8.8.8"],
      features: { "containerd-snapshotter": true },
      "live-restore": true,
      "log-driver": "local",
      proxies: { "no-proxy": "localhost" },
      "registry-mirrors": ["https://mirror.example.com/"],
    });
  });

  it("restores the previous daemon file when restart fails", async () => {
    const original = '{"features":{"containerd-snapshotter":true}}\n';
    const written: string[] = [];
    let restarts = 0;
    const command: CommandRunner = vi.fn(async (executable, args, options) => {
      if (executable === "docker") return { stderr: "", stdout: "29.7.2\n" };
      if (args[0] === "list") return { stderr: "", stdout: limaRow };
      if (args.includes("systemctl")) {
        restarts += 1;
        if (restarts === 1) throw commandFailure("systemctl restart docker", "restart failed");
        return { stderr: "", stdout: "" };
      }
      if (args[0] === "shell" && args.at(-1)?.includes("dockerd --validate")) {
        written.push(options.input ?? "");
        return { stderr: "", stdout: "configuration OK\n" };
      }
      return { stderr: "", stdout: `file\n${original}` };
    });
    const runtime = new LimaDockerRuntime(command);

    await expect(
      runtime.applyDockerDaemonConfiguration({
        additionalJson: "{}",
        configuration: {
          debug: false,
          defaultAddressPools: [],
          dns: [],
          insecureRegistries: [],
          liveRestore: true,
          logDriver: "local",
          maxConcurrentDownloads: 3,
          maxConcurrentUploads: 5,
          proxies: { noProxy: [] },
          registryMirrors: [],
        },
      }),
    ).rejects.toThrow("이전 설정으로 복구했습니다");
    expect(written).toHaveLength(2);
    expect(written[1]).toBe(original);
    expect(restarts).toBe(2);
  });

  it("makes the macOS home mount writable and selects the overseer Docker context", async () => {
    let status = "Running";
    let writable = false;
    const docker = dockerContextResponder();
    const commands: Array<{ args: readonly string[]; executable: string }> = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      commands.push({ args, executable });
      if (executable === "docker") return docker(args);
      if (args[0] === "list" && args.includes("--json")) {
        return { stderr: "", stdout: limaDetails({ status, writable }) };
      }
      if (args[0] === "list") {
        return { stderr: "", stdout: `overseer\t${status}\t/tmp/overseer\n` };
      }
      if (args[0] === "stop") status = "Stopped";
      if (args[0] === "edit") writable = true;
      if (args[0] === "start") status = "Running";
      return { stderr: "", stdout: "" };
    });
    const runtime = new LimaDockerRuntime(command);

    await runtime.connectDockerCli();

    expect(commands).toEqual(
      expect.arrayContaining([
        { args: ["stop", "overseer"], executable: "limactl" },
        {
          args: ["edit", "overseer", "--mount-writable", "--tty=false"],
          executable: "limactl",
        },
        {
          args: [
            "context",
            "create",
            "overseer",
            "--description",
            "Overseer Lima Docker Engine",
            "--docker",
            "host=unix:///tmp/overseer/sock/docker.sock",
          ],
          executable: "docker",
        },
        { args: ["context", "use", "overseer"], executable: "docker" },
      ]),
    );
  });

  it.each(["vz", "qemu"] as const)(
    "creates a missing %s engine with explicit resource settings",
    async (vmType) => {
      let exists = false;
      const docker = dockerContextResponder();
      const commands: Array<{ args: readonly string[]; executable: string }> = [];
      const command: CommandRunner = vi.fn(async (executable, args) => {
        commands.push({ args, executable });
        if (executable.startsWith("qemu-system-")) {
          return { stderr: "", stdout: "QEMU emulator version 10.1.0\n" };
        }
        if (executable === "limactl" && args[0] === "list") {
          if (!exists) throw commandFailure("limactl list", "No instance matching overseer found.");
          return {
            stderr: "",
            stdout: args.includes("--json") ? limaDetails({ vmType }) : limaRow,
          };
        }
        if (executable === "limactl" && args[0] === "start") {
          exists = true;
          return { stderr: "", stdout: "" };
        }
        if (executable === "docker") return docker(args);
        return { stderr: "", stdout: "" };
      });
      const runtime = new LimaDockerRuntime(command);

      await expect(
        runtime.startRuntime(undefined, { ...dockerEngineConfiguration, vmType }),
      ).resolves.toMatchObject({ dockerVersion: "29.7.2", phase: "running" });
      expect(commands).toContainEqual({
        args: [
          "start",
          "--name=overseer",
          `--vm-type=${vmType}`,
          "--cpus=4",
          "--memory=4",
          "--disk=100",
          "--mount-writable",
          "template:docker",
          "--tty=false",
          "--progress",
        ],
        executable: "limactl",
      });
    },
  );

  it("recreates the single VM in stop, delete, create order", async () => {
    let exists = true;
    const docker = dockerContextResponder();
    const lifecycle: string[] = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable === "limactl" && args[0] === "list") {
        if (!exists) throw commandFailure("limactl list", "No instance matching overseer found.");
        return { stderr: "", stdout: args.includes("--json") ? limaDetails() : limaRow };
      }
      if (executable === "limactl" && args[0] === "stop") lifecycle.push("stop");
      if (executable === "limactl" && args[0] === "delete") {
        lifecycle.push("delete");
        exists = false;
      }
      if (executable === "limactl" && args[0] === "start") {
        lifecycle.push("start");
        exists = true;
      }
      if (executable === "docker") return docker(args);
      return { stderr: "", stdout: "" };
    });
    const runtime = new LimaDockerRuntime(command);

    await expect(runtime.recreateRuntime(dockerEngineConfiguration)).resolves.toMatchObject({
      dockerVersion: "29.7.2",
      phase: "running",
    });
    expect(lifecycle).toEqual(["stop", "delete", "start"]);
  });

  it("rejects unavailable QEMU before stopping the existing VM", async () => {
    const command: CommandRunner = vi.fn(async (executable) => {
      if (executable.startsWith("qemu-system-")) {
        throw commandFailure(executable, "command not found");
      }
      return { stderr: "", stdout: limaRow };
    });
    const runtime = new LimaDockerRuntime(command);

    await expect(
      runtime.recreateRuntime({ ...dockerEngineConfiguration, vmType: "qemu" }),
    ).rejects.toThrow("brew install qemu");
    expect(
      vi
        .mocked(command)
        .mock.calls.some(
          ([executable, args]) =>
            executable === "limactl" && (args[0] === "stop" || args[0] === "delete"),
        ),
    ).toBe(false);
  });

  it("does not create a replacement when deletion fails", async () => {
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable === "limactl" && args[0] === "list") {
        return { stderr: "", stdout: limaRow };
      }
      if (executable === "limactl" && args[0] === "delete") {
        throw commandFailure("limactl delete", "delete failed");
      }
      return { stderr: "", stdout: "" };
    });
    const runtime = new LimaDockerRuntime(command);

    await expect(runtime.recreateRuntime(dockerEngineConfiguration)).rejects.toThrow(
      "delete failed",
    );
    expect(
      vi
        .mocked(command)
        .mock.calls.some(([executable, args]) => executable === "limactl" && args[0] === "start"),
    ).toBe(false);
  });

  it("reports the runtime as missing when replacement creation fails after deletion", async () => {
    let exists = true;
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable === "limactl" && args[0] === "list") {
        if (!exists) throw commandFailure("limactl list", "No instance matching overseer found.");
        return { stderr: "", stdout: limaRow };
      }
      if (executable === "limactl" && args[0] === "delete") {
        exists = false;
        return { stderr: "", stdout: "" };
      }
      if (executable === "limactl" && args[0] === "start") {
        throw commandFailure("limactl start", "create failed");
      }
      return { stderr: "", stdout: "" };
    });
    const runtime = new LimaDockerRuntime(command);

    await expect(runtime.recreateRuntime(dockerEngineConfiguration)).rejects.toThrow(
      "create failed",
    );
    await expect(runtime.getDashboard()).resolves.toMatchObject({ runtime: { phase: "missing" } });
  });
});
