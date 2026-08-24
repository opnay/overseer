import { describe, expect, it } from "vitest";
import {
  composeProjectDetailPath,
  containerDetailPath,
  getAppDetailLocation,
  getAppLocation,
  getAppRoute,
} from "../src/client/routes.ts";

describe("application routes", () => {
  it("recognizes direct Compose and container detail URLs", () => {
    expect(getAppDetailLocation("/compose/demo-stack")).toEqual({
      identifier: "demo-stack",
      parentPath: "/compose",
      path: "/compose/demo-stack",
      type: "compose",
    });
    expect(getAppDetailLocation("/containers/container-id")).toEqual({
      identifier: "container-id",
      parentPath: "/containers",
      path: "/containers/container-id",
      type: "container",
    });
    expect(getAppLocation("/compose/demo-stack")).toBe("/compose/demo-stack");
    expect(getAppRoute("/containers/container-id").path).toBe("/containers");
  });

  it("encodes detail paths and rejects invalid nested routes", () => {
    expect(composeProjectDetailPath("demo-stack")).toBe("/compose/demo-stack");
    expect(containerDetailPath("worker:latest")).toBe("/containers/worker%3Alatest");
    expect(getAppDetailLocation("/compose/INVALID")).toBeUndefined();
    expect(getAppDetailLocation("/containers/id/extra")).toBeUndefined();
    expect(getAppLocation("/containers/id/extra")).toBe("/containers");
  });
});
