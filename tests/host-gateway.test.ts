import { describe, expect, it, vi } from "vitest";
import { LimaDockerRuntime } from "../src/server/infrastructure/lima/lima-docker-runtime.ts";
import { parseUpdateDockerDaemonConfigurationSectionInput } from "../src/server/modules/engine/index.ts";
import type { CommandRunner } from "../src/server/infrastructure/process.ts";

function engine(
  initial: Record<string, unknown> = {},
  addresses = "192.168.5.2 STREAM host.lima.internal\n",
) {
  let source = JSON.stringify(initial);
  const writes: string[] = [];
  const command: CommandRunner = vi.fn(async (executable, args, options) => {
    if (executable === "docker") return { stderr: "", stdout: "29.9.0\n" };
    if (args[0] === "list") return { stderr: "", stdout: "overseer\tRunning\t/tmp/overseer\n" };
    if (args.includes("getent")) return { stderr: "", stdout: addresses };
    if (args.at(-1)?.includes("dockerd --validate")) {
      source = options.input ?? "";
      writes.push(source);
      return { stderr: "", stdout: "configuration OK\n" };
    }
    if (args.includes("systemctl")) return { stderr: "", stdout: "" };
    return { stderr: "", stdout: `file\n${source}\n` };
  });
  return { command, runtime: new LimaDockerRuntime(command), writes };
}

const network = { defaultAddressPools: [], dns: [] };

describe("macOS host-gateway mapping", () => {
  it("accepts only a boolean gateway option through the network API parser", () => {
    expect(
      parseUpdateDockerDaemonConfigurationSectionInput("network", {
        configuration: { ...network, hostGatewayToMacOS: true },
      }),
    ).toMatchObject({ configuration: { hostGatewayToMacOS: true } });
    expect(() =>
      parseUpdateDockerDaemonConfigurationSectionInput("network", {
        configuration: { ...network, hostGatewayToMacOS: "true" },
      }),
    ).toThrow("host-gateway");
  });

  it.each([{ "host-gateway-ip": "192.168.5.2" }, { "host-gateway-ips": ["192.168.5.2"] }])(
    "recognizes an existing macOS mapping: %j",
    async (raw) => {
      expect(
        (await engine(raw).runtime.getDockerDaemonConfiguration()).configuration.hostGatewayToMacOS,
      ).toBe(true);
    },
  );

  it("resolves the VM's host address and applies it without losing custom daemon settings", async () => {
    const { runtime, writes } = engine(
      { features: { cdi: true }, "host-gateway-ips": ["10.0.0.4", "fd00::4"] },
      "192.168.104.2 STREAM host.lima.internal\n192.168.104.2 DGRAM\n",
    );
    await runtime.applyDockerDaemonConfigurationSection({
      section: "network",
      configuration: { ...network, hostGatewayToMacOS: true },
    });
    expect(JSON.parse(writes[0]!)).toMatchObject({
      features: { cdi: true },
      "host-gateway-ip": "192.168.104.2",
    });
    expect(JSON.parse(writes[0]!)).not.toHaveProperty("host-gateway-ips");
    expect((await runtime.getDockerDaemonConfiguration()).configuration.hostGatewayToMacOS).toBe(
      true,
    );
  });

  it("disables the macOS mapping and returns to Docker's default", async () => {
    const { runtime, writes } = engine({
      "host-gateway-ip": "192.168.5.2",
      features: { cdi: true },
    });
    await runtime.applyDockerDaemonConfigurationSection({
      section: "network",
      configuration: { ...network, hostGatewayToMacOS: false },
    });
    expect(JSON.parse(writes[0]!)).not.toHaveProperty("host-gateway-ip");
    expect((await runtime.getDockerDaemonConfiguration()).configuration.hostGatewayToMacOS).toBe(
      false,
    );
  });

  it("preserves an existing custom address when saving network fields with the switch off", async () => {
    const { runtime, writes } = engine({ "host-gateway-ips": ["10.0.0.4", "fd00::4"] });
    await runtime.applyDockerDaemonConfigurationSection({
      section: "network",
      configuration: { ...network, hostGatewayToMacOS: false },
    });
    expect(JSON.parse(writes[0]!)["host-gateway-ips"]).toEqual(["10.0.0.4", "fd00::4"]);
  });

  it.each(["", "127.0.0.1 STREAM\n", "192.168.5.2 STREAM\n192.168.104.2 STREAM\n"])(
    "does not write when the host address cannot be selected: %j",
    async (addresses) => {
      const { runtime, writes } = engine({}, addresses);
      await expect(
        runtime.applyDockerDaemonConfigurationSection({
          section: "network",
          configuration: { ...network, hostGatewayToMacOS: true },
        }),
      ).rejects.toThrow("macOS");
      expect(writes).toEqual([]);
    },
  );

  it("does not override a manual advanced JSON edit while the mapping was enabled", async () => {
    const { runtime, writes } = engine({ "host-gateway-ip": "192.168.5.2" });
    await runtime.applyDockerDaemonConfigurationSection({
      section: "advanced",
      additionalJson: '{"host-gateway-ip":"10.0.0.4"}',
    });
    expect(JSON.parse(writes[0]!)["host-gateway-ip"]).toBe("10.0.0.4");
  });
});

describe("host-gateway migration", () => {
  function migratableEngine(
    addresses = "192.168.5.2 STREAM host.lima.internal\n",
    initial: Record<string, unknown> = {},
  ) {
    let source = JSON.stringify(initial);
    let migrated = false;
    let failRestart = false;
    let failMarker = false;
    const writes: string[] = [];
    const command: CommandRunner = vi.fn(async (executable, args, options) => {
      if (executable === "docker") return { stdout: "29.9.0\n", stderr: "" };
      if (args[0] === "list")
        return {
          stdout: args.includes("--json")
            ? JSON.stringify({
                name: "overseer",
                dir: "/tmp/overseer",
                status: "Running",
                vmType: "vz",
                cpus: 4,
                memory: 4294967296,
                disk: 107374182400,
                config: {
                  portForwards: [
                    {
                      guestSocket: "/run/user/501/docker.sock",
                      hostSocket: "/tmp/overseer/sock/docker.sock",
                    },
                  ],
                },
              })
            : "overseer\tRunning\t/tmp/overseer\n",
          stderr: "",
        };
      if (args.includes("getent")) return { stdout: addresses, stderr: "" };
      if (args.at(-1)?.includes("host-gateway-macos-v1")) {
        if (args.at(-1)?.includes("mv ")) {
          if (failMarker) {
            failMarker = false;
            throw Error("marker unavailable");
          }
          migrated = true;
        }
        return { stdout: migrated ? "done\n" : "pending\n", stderr: "" };
      }
      if (args.at(-1)?.includes("dockerd --validate")) {
        source = options.input!;
        writes.push(source);
        return { stdout: "configuration OK\n", stderr: "" };
      }
      if (args.includes("systemctl")) {
        if (failRestart) {
          failRestart = false;
          throw Error("restart failed");
        }
        return { stdout: "", stderr: "" };
      }
      return { stdout: `file\n${source}\n`, stderr: "" };
    });
    return {
      command,
      writes,
      runtime: new LimaDockerRuntime(command),
      get migrated() {
        return migrated;
      },
      failNext(stage: string) {
        if (stage === "restart") failRestart = true;
        else failMarker = true;
      },
    };
  }

  it.each([{}, { "host-gateway-ip": "10.0.0.4" }])(
    "enables an existing VM once and preserves explicit false across app restarts: %j",
    async (initial) => {
      const fixture = migratableEngine(undefined, initial);
      expect(await fixture.runtime.pendingMacOSHostGatewayMigrations()).toEqual(["overseer"]);
      await fixture.runtime.migrateMacOSHostGateway("overseer");
      expect(JSON.parse(fixture.writes[0]!)["host-gateway-ip"]).toBe("192.168.5.2");
      expect(fixture.migrated).toBe(true);
      await fixture.runtime.applyDockerDaemonConfigurationSection({
        section: "network",
        configuration: { ...network, hostGatewayToMacOS: false },
      });
      const restarted = new LimaDockerRuntime(fixture.command);
      expect(await restarted.pendingMacOSHostGatewayMigrations()).toEqual([]);
      await restarted.migrateMacOSHostGateway("overseer");
      expect(fixture.writes).toHaveLength(2);
      expect(
        (await restarted.getDockerDaemonConfiguration()).configuration.hostGatewayToMacOS,
      ).toBe(false);
    },
  );

  it.each(["restart", "marker"])(
    "leaves a failed migration pending and retries without losing the original configuration: %s",
    async (stage) => {
      const fixture = migratableEngine();
      fixture.failNext(stage);
      await expect(fixture.runtime.migrateMacOSHostGateway("overseer")).rejects.toThrow(
        "이전 설정으로 복구",
      );
      expect(fixture.migrated).toBe(false);
      expect(JSON.parse(fixture.writes.at(-1)!)).toEqual({});
      await fixture.runtime.migrateMacOSHostGateway("overseer");
      expect(fixture.migrated).toBe(true);
    },
  );
});
