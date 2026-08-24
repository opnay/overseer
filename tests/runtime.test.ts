import { describe, expect, it, vi } from "vitest";
import { emptyContainerSpec } from "../src/shared/container-spec.ts";
import { LimaDockerRuntime, type CommandRunner } from "../src/server/lima-docker-runtime.ts";
import { CommandError } from "../src/server/process.ts";
import type { BuilderComposeRegistry } from "../src/server/builder-compose.ts";
import type { RemoteComposeRegistry } from "../src/server/remote-compose.ts";

const limaRow = "overseer\tRunning\t/tmp/overseer\n";

function commandFailure(command: string, stderr: string) {
  return new CommandError(command, Object.assign(new Error("command failed"), { code: 1 }), stderr);
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
    Mounts: [{ Destination: "/data", Name: "audit-data", RW: true, Type: "volume" }],
    Name: "/web",
    NetworkSettings: { Networks: { bridge: {} } },
    State: { Running: true },
  };
}

describe("LimaDockerRuntime container configuration", () => {
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

  it("runs a remote project from a writable Lima guest directory", async () => {
    const commands: Array<{ args: readonly string[]; executable: string }> = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      commands.push({ args, executable });
      if (executable === "limactl" && args[0] === "list") {
        return { stderr: "", stdout: limaRow };
      }
      if (executable === "docker") return { stderr: "", stdout: "[]" };
      if (executable === "limactl" && args.includes("printenv")) {
        return { stderr: "", stdout: "/home/test.guest\n" };
      }
      return { stderr: "", stdout: "" };
    });
    const registry: RemoteComposeRegistry = {
      applyUpdate: vi.fn(async () => undefined),
      checkUpdate: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
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

    await runtime.composeProjectAction("remote-stack", "up");

    expect(commands).toContainEqual({
      args: [
        "copy",
        "--backend=scp",
        "/host/compose/remote-stack/compose.yaml",
        "overseer:/home/test.guest/.local/share/overseer/compose/remote-stack/compose.yaml",
      ],
      executable: "limactl",
    });
    expect(commands).toContainEqual({
      args: [
        "shell",
        "--workdir",
        "/home/test.guest/.local/share/overseer/compose/remote-stack",
        "overseer",
        "docker",
        "compose",
        "--project-name",
        "remote-stack",
        "--file",
        "/home/test.guest/.local/share/overseer/compose/remote-stack/compose.yaml",
        "up",
        "--detach",
      ],
      executable: "limactl",
    });
    expect(
      commands.some(({ args, executable }) => executable === "docker" && args.includes("--detach")),
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
  it("lists a persisted form project and runs it from the Lima guest directory", async () => {
    const commands: Array<{ args: readonly string[]; executable: string }> = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      commands.push({ args, executable });
      if (executable === "limactl" && args[0] === "list") return { stderr: "", stdout: limaRow };
      if (executable === "docker") return { stderr: "", stdout: "[]" };
      if (executable === "limactl" && args.includes("printenv"))
        return { stderr: "", stdout: "/home/test.guest\n" };
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
      get: vi.fn(async () => undefined),
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
    await runtime.composeProjectAction("form-stack", "up");
    expect(commands).toContainEqual({
      args: [
        "copy",
        "--backend=scp",
        "/host/compose/form-stack/compose.yaml",
        "overseer:/home/test.guest/.local/share/overseer/compose/form-stack/compose.yaml",
      ],
      executable: "limactl",
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
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable.startsWith("qemu-system-")) {
        return { stderr: "", stdout: "QEMU emulator version 10.1.0\n" };
      }
      expect(args).toEqual(["list", "overseer", "--json"]);
      return {
        stderr: "",
        stdout: JSON.stringify({
          cpus: 6,
          dir: "/tmp/overseer",
          disk: 120 * 1024 ** 3,
          memory: 8 * 1024 ** 3,
          name: "overseer",
          status: "Running",
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
      source: "instance",
      vmTypes: [{ value: "vz" }, { available: true, value: "qemu" }],
    });
  });

  it.each(["vz", "qemu"] as const)(
    "creates a missing %s engine with explicit resource settings",
    async (vmType) => {
      let exists = false;
      const commands: Array<{ args: readonly string[]; executable: string }> = [];
      const command: CommandRunner = vi.fn(async (executable, args) => {
        commands.push({ args, executable });
        if (executable.startsWith("qemu-system-")) {
          return { stderr: "", stdout: "QEMU emulator version 10.1.0\n" };
        }
        if (executable === "limactl" && args[0] === "list") {
          if (!exists) throw commandFailure("limactl list", "No instance matching overseer found.");
          return { stderr: "", stdout: limaRow };
        }
        if (executable === "limactl" && args[0] === "start") {
          exists = true;
          return { stderr: "", stdout: "" };
        }
        return { stderr: "", stdout: "29.7.2\n" };
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
    const lifecycle: string[] = [];
    const command: CommandRunner = vi.fn(async (executable, args) => {
      if (executable === "limactl" && args[0] === "list") {
        if (!exists) throw commandFailure("limactl list", "No instance matching overseer found.");
        return { stderr: "", stdout: limaRow };
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
      return { stderr: "", stdout: executable === "docker" ? "29.7.2\n" : "" };
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
