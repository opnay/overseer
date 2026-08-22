import { describe, expect, it } from "vitest";
import { parseJsonLines } from "../src/server/process.ts";
import {
  optionalContainerName,
  optionalPort,
  requireContainerReference,
  requireImageReference,
  requireResourceName,
} from "../src/server/validation.ts";

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
