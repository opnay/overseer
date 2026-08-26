import { describe, expect, it } from "vitest";
import { parseJsonLines } from "../src/server/core/json-lines.ts";
import { emptyContainerSpec, validateContainerSpec } from "../src/shared/container-spec.ts";
import {
  optionalContainerName,
  optionalPort,
  requireContainerReference,
  requireImageReference,
  requireResourceName,
} from "../src/server/core/validation.ts";

describe("command input validation", () => {
  it("accepts normal Docker references", () => {
    expect(requireImageReference("ghcr.io/opnay/app:latest")).toBe("ghcr.io/opnay/app:latest");
    expect(requireContainerReference("overseer-web_1")).toBe("overseer-web_1");
    expect(optionalContainerName("api-1")).toBe("api-1");
    expect(optionalPort(8080)).toBe(8080);
    expect(requireResourceName("app-data")).toBe("app-data");
  });

  it("rejects shell syntax and invalid ports", () => {
    expect(() => requireImageReference("alpine; rm -rf /")).toThrow("유효한 이미지");
    expect(() => optionalContainerName("api $(whoami)")).toThrow("컨테이너 이름");
    expect(() => optionalPort(0)).toThrow("1–65535");
    expect(() => requireResourceName("app/data")).toThrow("이름은");
  });
});

describe("parseJsonLines", () => {
  it("parses Docker JSON line output", () => {
    expect(parseJsonLines<{ ID: string }>('{"ID":"one"}\n{"ID":"two"}\n')).toEqual([
      { ID: "one" },
      { ID: "two" },
    ]);
  });

  it("returns an empty list for empty output", () => {
    expect(parseJsonLines("")).toEqual([]);
  });
});

describe("container spec validation", () => {
  it("accepts the supported container settings", () => {
    const errors = validateContainerSpec({
      ...emptyContainerSpec(),
      command: ["sh", "-c", "echo ready"],
      environment: [{ key: "NODE_ENV", value: "production" }],
      hostname: "web.local",
      image: "nginx:alpine",
      labels: [{ key: "team", value: "platform" }],
      name: "web",
      networks: ["app-network"],
      ports: [{ containerPort: 80, protocol: "tcp" }],
      resources: { cpus: 0.5, memoryMiB: 128 },
      restartPolicy: { mode: "on-failure", maximumRetryCount: 3 },
      volumes: [{ containerPath: "/data", readOnly: false, volume: "app-data" }],
    });
    expect(errors).toEqual({});
  });

  it("rejects duplicates, unsafe paths, host networking, and reserved labels", () => {
    const errors = validateContainerSpec({
      ...emptyContainerSpec(),
      environment: [
        { key: "PORT", value: "80" },
        { key: "PORT", value: "81" },
      ],
      image: "nginx:alpine",
      labels: [{ key: "com.opnay.overseer.managed", value: "false" }],
      networks: ["host"],
      ports: [
        { containerPort: 80, protocol: "tcp" },
        { containerPort: 80, protocol: "tcp" },
      ],
      volumes: [{ containerPath: "/data/../secret", readOnly: false, volume: "app-data" }],
    });
    expect(errors).toMatchObject({ environment: expect.any(String), labels: expect.any(String) });
    expect(errors.networks).toBeTruthy();
    expect(errors.ports).toBeTruthy();
    expect(errors.volumes).toBeTruthy();
  });
});
