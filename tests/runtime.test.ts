import { describe, expect, it, vi } from "vitest";
import { emptyContainerSpec } from "../src/shared/container-spec.ts";
import { LimaDockerRuntime, type CommandRunner } from "../src/server/lima-docker-runtime.ts";
import { CommandError } from "../src/server/process.ts";

const limaRow = "overseer\tRunning\t/tmp/overseer\n";

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
