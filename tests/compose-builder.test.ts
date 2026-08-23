import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderComposeService, BuilderComposeStore } from "../src/server/builder-compose.ts";
import { composeBuilderYaml, validateComposeBuilderSpec } from "../src/shared/compose-builder.ts";
import type { ComposeBuilderSpec } from "../src/shared/contracts.ts";
import type { CommandRunner } from "../src/server/lima-docker-runtime.ts";

const temporaryDirectories: string[] = [];

async function temporaryStore() {
  const directory = await mkdtemp(join(tmpdir(), "overseer-builder-compose-test-"));
  temporaryDirectories.push(directory);
  return {
    directory,
    store: new BuilderComposeStore({
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

function fixture(): ComposeBuilderSpec {
  return {
    name: "demo-stack",
    networks: ["frontend"],
    services: [
      {
        command: ["nginx", "-g", "daemon off;"],
        containerName: "demo-web",
        environment: [{ key: "MODE", value: "production" }],
        image: "nginx",
        name: "web",
        networks: ["frontend"],
        ports: [{ containerPort: 80, hostPort: 8080, protocol: "tcp" }],
        restartPolicy: { mode: "unless-stopped" },
        tag: "1.29-alpine",
        volumes: [{ containerPath: "/data", readOnly: false, volume: "web-data" }],
      },
    ],
    volumes: ["web-data"],
  };
}

describe("Compose builder contract", () => {
  it("generates deterministic image-only Compose YAML", () => {
    const spec = fixture();
    expect(validateComposeBuilderSpec(spec)).toEqual([]);
    const yaml = composeBuilderYaml(spec);
    expect(yaml).toContain('image: "nginx:1.29-alpine"');
    expect(yaml).toContain('host_ip: "127.0.0.1"');
    expect(yaml).toContain("source: web-data");
    expect(yaml).toContain("networks:\n  frontend:");
    expect(yaml).not.toContain("build:");
    expect(composeBuilderYaml(spec)).toBe(yaml);
  });

  it("rejects duplicate and undeclared service resources", () => {
    const spec = fixture();
    spec.networks.push("frontend");
    spec.services[0]!.networks = ["missing"];
    const messages = validateComposeBuilderSpec(spec).map(({ message }) => message);
    expect(messages).toContain("network 이름이 중복됩니다.");
    expect(messages).toContain("web 서비스가 등록되지 않은 network를 사용합니다.");
  });

  it("validates and renders on-failure retry counts", () => {
    const spec = fixture();
    spec.services[0]!.restartPolicy = { maximumRetryCount: 3, mode: "on-failure" };
    expect(validateComposeBuilderSpec(spec)).toEqual([]);
    expect(composeBuilderYaml(spec)).toContain('restart: "on-failure:3"');

    spec.services[0]!.restartPolicy = { maximumRetryCount: -1, mode: "on-failure" };
    expect(validateComposeBuilderSpec(spec)[0]?.path).toBe("services.0.restartPolicy");
  });

  it("rejects container names and fixed host ports shared by services", () => {
    const spec = fixture();
    spec.services.push({ ...fixture().services[0]!, name: "worker" });
    const messages = validateComposeBuilderSpec(spec).map(({ message }) => message);
    expect(messages).toContain("컨테이너 이름이 중복됩니다.");
    expect(messages).toContain("호스트 포트 8080/tcp가 여러 서비스에서 중복됩니다.");
  });
});

describe("BuilderComposeService", () => {
  it("persists, updates with a config hash, materializes, and removes a project", async () => {
    const { directory, store } = await temporaryStore();
    const validate = vi.fn(async () => undefined);
    const service = new BuilderComposeService(vi.fn() as unknown as CommandRunner, {
      store,
      validate,
    });
    const registered = await service.register(fixture(), []);
    expect(registered.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(registered.configFile, "utf8")).toBe(registered.yaml);
    expect(validate).toHaveBeenCalledWith("demo-stack", registered.yaml);

    const changed = fixture();
    changed.services[0]!.tag = "1.30-alpine";
    const updated = await service.update("demo-stack", {
      expectedConfigHash: registered.configHash,
      spec: changed,
    });
    expect(updated.configHash).not.toBe(registered.configHash);
    expect(updated.yaml).toContain('image: "nginx:1.30-alpine"');
    await expect(
      service.update("demo-stack", {
        expectedConfigHash: registered.configHash,
        spec: changed,
      }),
    ).rejects.toThrow("다시 불러온 뒤");

    store.close();
    const reopenedStore = new BuilderComposeStore({
      dataDirectory: directory,
      databasePath: join(directory, "overseer.sqlite"),
    });
    expect(reopenedStore.get("demo-stack")?.spec.services[0]?.tag).toBe("1.30-alpine");
    reopenedStore.close();

    const removalStore = new BuilderComposeStore({
      dataDirectory: directory,
      databasePath: join(directory, "overseer.sqlite"),
    });
    const removalService = new BuilderComposeService(vi.fn() as unknown as CommandRunner, {
      store: removalStore,
      validate,
    });
    await removalService.remove("demo-stack");
    expect(await removalService.get("demo-stack")).toBeUndefined();
    removalStore.close();
  });
});
