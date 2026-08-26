import { describe, expect, it } from "vitest";
import {
  dockerDaemonConfigurationToForm,
  preserveDockerDaemonConfigurationDrafts,
  resetDockerDaemonConfigurationSection,
} from "../src/client/pages/settings/index.ts";
import type { DockerDaemonConfigurationSnapshot } from "../src/shared/contracts.ts";

function snapshot(): DockerDaemonConfigurationSnapshot {
  return {
    additionalJson: '{"features":{"containerd-snapshotter":true}}',
    available: true,
    configuration: {
      debug: false,
      defaultAddressPools: [{ base: "172.31.0.0/16", size: 24 }],
      dns: ["8.8.8.8"],
      insecureRegistries: [],
      liveRestore: false,
      logDriver: "json-file",
      maxConcurrentDownloads: 3,
      maxConcurrentUploads: 5,
      proxies: { noProxy: [] },
      registryMirrors: [],
    },
    message: "ready",
    path: "~/.config/docker/daemon.json",
    source: "file",
  };
}

describe("Docker daemon configuration form sections", () => {
  it("keeps dirty drafts while refreshing saved sections", () => {
    const fresh = dockerDaemonConfigurationToForm(snapshot());
    const draft = {
      ...fresh,
      dns: "1.1.1.1",
      registryMirrors: "https://draft.example.com",
    };

    expect(preserveDockerDaemonConfigurationDrafts(fresh, draft, ["registry"])).toMatchObject({
      dns: "8.8.8.8",
      registryMirrors: "https://draft.example.com",
    });
  });

  it("resets only the selected section", () => {
    const current = dockerDaemonConfigurationToForm(snapshot());
    const draft = {
      ...current,
      dns: "1.1.1.1",
      registryMirrors: "https://draft.example.com",
    };

    expect(resetDockerDaemonConfigurationSection(draft, snapshot(), "network")).toMatchObject({
      dns: "8.8.8.8",
      registryMirrors: "https://draft.example.com",
    });
  });
});
