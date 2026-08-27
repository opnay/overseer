import { describe, expect, it } from "vitest";
import {
  composeProjectDetailPath,
  containerDetailPath,
  getAppDetailLocation,
  getAppLocation,
  getAppRoute,
  imageDetailPath,
  imageRepositoryDetailPath,
  runtimeInstanceDetailPath,
  networkDetailPath,
  volumeDetailPath,
} from "../src/client/shared/routes/index.ts";

describe("application routes", () => {
  it("recognizes direct resource detail URLs", () => {
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
    expect(
      getAppDetailLocation("/image-repositories/11111111-1111-4111-8111-111111111111"),
    ).toEqual({
      identifier: "11111111-1111-4111-8111-111111111111",
      parentPath: "/image-repositories",
      path: "/image-repositories/11111111-1111-4111-8111-111111111111",
      type: "imageRepository",
    });
    expect(getAppDetailLocation("/instances/dev-engine")).toEqual({
      identifier: "dev-engine",
      parentPath: "/instances",
      path: "/instances/dev-engine",
      type: "instance",
    });
    expect(getAppDetailLocation("/networks/app-network")).toEqual({
      identifier: "app-network",
      parentPath: "/networks",
      path: "/networks/app-network",
      type: "network",
    });
    expect(getAppDetailLocation("/volumes/app-data")).toEqual({
      identifier: "app-data",
      parentPath: "/volumes",
      path: "/volumes/app-data",
      type: "volume",
    });
    expect(getAppLocation("/compose/demo-stack")).toBe("/compose/demo-stack");
    expect(getAppRoute("/containers/container-id").path).toBe("/containers");
    expect(getAppRoute("/images/3e24e96c89ef").path).toBe("/images");
    expect(getAppRoute("/image-repositories/11111111-1111-4111-8111-111111111111").path).toBe(
      "/image-repositories",
    );
    expect(getAppRoute("/networks/app-network").path).toBe("/networks");
    expect(getAppRoute("/volumes/app-data").path).toBe("/volumes");
  });

  it("encodes detail paths and rejects invalid nested routes", () => {
    expect(composeProjectDetailPath("demo-stack")).toBe("/compose/demo-stack");
    expect(runtimeInstanceDetailPath("dev engine")).toBe("/instances/dev%20engine");
    expect(containerDetailPath("worker:latest")).toBe("/containers/worker%3Alatest");
    expect(imageDetailPath("3e24e96c89ef")).toBe("/images/3e24e96c89ef");
    expect(imageRepositoryDetailPath("11111111-1111-4111-8111-111111111111")).toBe(
      "/image-repositories/11111111-1111-4111-8111-111111111111",
    );
    expect(networkDetailPath("app network")).toBe("/networks/app%20network");
    expect(volumeDetailPath("app data")).toBe("/volumes/app%20data");
    expect(getAppDetailLocation("/compose/INVALID")).toBeUndefined();
    expect(getAppDetailLocation("/images/not-an-image")).toBeUndefined();
    expect(getAppDetailLocation("/instances/Invalid")).toBeUndefined();
    expect(getAppDetailLocation("/containers/id/extra")).toBeUndefined();
    expect(getAppDetailLocation("/volumes/bad%2Fname")).toBeUndefined();
    expect(getAppLocation("/containers/id/extra")).toBe("/containers");
  });
});
