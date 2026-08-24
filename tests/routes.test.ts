import { describe, expect, it } from "vitest";
import {
  composeProjectDetailPath,
  containerDetailPath,
  getAppDetailLocation,
  getAppLocation,
  getAppRoute,
  imageDetailPath,
} from "../src/client/routes.ts";

describe("application routes", () => {
  it("recognizes direct Compose, container, and image detail URLs", () => {
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
    expect(getAppDetailLocation("/images/3e24e96c89ef")).toEqual({
      identifier: "3e24e96c89ef",
      parentPath: "/images",
      path: "/images/3e24e96c89ef",
      type: "image",
    });
    expect(getAppLocation("/compose/demo-stack")).toBe("/compose/demo-stack");
    expect(getAppRoute("/containers/container-id").path).toBe("/containers");
    expect(getAppRoute("/images/3e24e96c89ef").path).toBe("/images");
  });

  it("encodes detail paths and rejects invalid nested routes", () => {
    expect(composeProjectDetailPath("demo-stack")).toBe("/compose/demo-stack");
    expect(containerDetailPath("worker:latest")).toBe("/containers/worker%3Alatest");
    expect(imageDetailPath("3e24e96c89ef")).toBe("/images/3e24e96c89ef");
    expect(getAppDetailLocation("/compose/INVALID")).toBeUndefined();
    expect(getAppDetailLocation("/images/not-an-image")).toBeUndefined();
    expect(getAppDetailLocation("/containers/id/extra")).toBeUndefined();
    expect(getAppLocation("/containers/id/extra")).toBe("/containers");
  });
});
