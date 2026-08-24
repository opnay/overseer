import { describe, expect, it } from "vitest";
import { reconstructDockerfileLayers } from "../src/client/image-history-presentation.ts";
import type { ImageHistoryEntry } from "../src/shared/contracts.ts";

function history(createdBy: string, size = "0B"): ImageHistoryEntry {
  return {
    createdAt: "2026-08-22T18:22:08+09:00",
    createdBy,
    createdSince: "2 days ago",
    size,
  };
}

describe("image history presentation", () => {
  it("reconstructs Dockerfile instructions from oldest to newest layer", () => {
    expect(
      reconstructDockerfileLayers([
        history('CMD ["node" "server.js"]'),
        history("COPY /app /app # buildkit", "284MB"),
      ]),
    ).toBe(`# Layer 1 · 284MB
COPY /app /app

# Layer 2 · 0B
CMD ["node" "server.js"]`);
  });

  it("breaks after unquoted shell operators with Dockerfile continuations", () => {
    expect(
      reconstructDockerfileLayers([
        history(
          'RUN /bin/sh -c echo    "a  && b"\t&&   curl example.test | tee /tmp/result || printf ready; exit 1 # buildkit',
          "12kB",
        ),
      ]),
    ).toBe(`# Layer 1 · 12kB
RUN echo "a  && b" \\
    && curl example.test \\
    | tee /tmp/result \\
    || printf ready \\
    ; exit 1`);
  });

  it("removes BuildKit argument markers from reconstructed RUN instructions", () => {
    expect(
      reconstructDockerfileLayers([
        history("RUN |1 TARGETPLATFORM=linux/arm64 /bin/sh -c echo ready # buildkit"),
      ]),
    ).toContain("RUN echo ready");
  });
});
