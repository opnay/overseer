import { describe, expect, it } from "vitest";
import { SqliteRuntimeInstanceStore } from "../src/server/runtime-instance-store.ts";

describe("SqliteRuntimeInstanceStore", () => {
  it("persists the active and Overseer-managed instance separately", () => {
    const store = new SqliteRuntimeInstanceStore({ databasePath: ":memory:" });

    store.markManaged("overseer");
    store.setActiveInstanceName("external");

    expect(store.getActiveInstanceName()).toBe("external");
    expect(store.isManaged("overseer")).toBe(true);
    expect(store.isManaged("external")).toBe(false);

    store.clearActiveInstanceName("other");
    expect(store.getActiveInstanceName()).toBe("external");
    store.clearActiveInstanceName("external");
    store.unmarkManaged("overseer");

    expect(store.getActiveInstanceName()).toBeUndefined();
    expect(store.isManaged("overseer")).toBe(false);
    store.close();
  });
});
