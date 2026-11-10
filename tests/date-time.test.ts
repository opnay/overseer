import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatRelativeDateTime,
} from "../src/client/shared/lib/date-time/index.ts";

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

  it("formats elapsed units while preserving future and invalid timestamp handling", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(formatRelativeDateTime(now - 30_000, now)).toBe("방금");
    expect(formatRelativeDateTime(now - 60_000, now)).toBe("1분 전");
    expect(formatRelativeDateTime(now - 3_600_000, now)).toBe("1시간 전");
    expect(formatRelativeDateTime(now - 86_400_000, now)).toBe("1일 전");
    expect(formatRelativeDateTime(now + 86_400_000, now)).toBe("1일 후");
    expect(formatRelativeDateTime("not-a-date", now)).toBeUndefined();
  });
});
