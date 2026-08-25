import { describe, expect, it } from "vitest";
import { formatDateTime } from "../src/client/date-time.ts";

describe("date time presentation", () => {
  it("formats local date values with the shared numeric pattern", () => {
    expect(formatDateTime(new Date(2026, 7, 25, 9, 4, 5))).toBe("2026-08-25 09:04:05");
  });

  it("parses Docker timestamps and preserves invalid source values", () => {
    expect(formatDateTime("2026-08-23 03:33:21.721940098 +0900 KST")).toMatch(
      /^2026-08-\d{2} \d{2}:33:21$/,
    );
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});
