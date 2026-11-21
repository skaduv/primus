import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsSet = vi.fn<(patch: Record<string, unknown>) => Promise<void>>();
vi.mock("@/lib/platform", () => ({
  getPlatform: async () => ({ settingsSet }),
}));

import { useAppStore } from "./app-store";
import { resetSettingsStoreForTesting, useSettingsStore } from "./settings-store";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("设置保存", () => {
  beforeEach(() => {
    settingsSet.mockReset();
    resetSettingsStoreForTesting();
  });

  it("较早请求失败时不回滚较晚请求已保存的字段", async () => {
    const a = deferred();
    settingsSet.mockImplementationOnce(() => a.promise).mockResolvedValueOnce(undefined);
    const store = useSettingsStore.getState();
    const first = store.patch({ advancedEnabled: true });
    await store.patch({ agentReplyStyle: "详细" });
    expect(useSettingsStore.getState().saving).toBe(true);
    a.reject(new Error("写入失败"));
    await first;
    const state = useSettingsStore.getState();
    expect(state.agentReplyStyle).toBe("详细");
    expect(state.advancedEnabled).toBe(false);
    expect(state.saving).toBe(false);
    expect(state.error).toBe("写入失败");
  });

  it("同一字段被较晚请求改写后，较早请求失败不恢复旧值", async () => {
    const initialPerm = useAppStore.getState().permissionMode;
    const next = initialPerm === "full" ? "ask" : "full";
    const a = deferred();
    settingsSet.mockImplementationOnce(() => a.promise).mockResolvedValueOnce(undefined);
    const store = useSettingsStore.getState();
    const first = store.patch({ permissionMode: "edit" });
    await store.patch({ permissionMode: next });
    a.reject(new Error("x"));
    await first;
    expect(useAppStore.getState().permissionMode).toBe(next);
  });

  it("单个请求失败时回滚本次修改", async () => {
    settingsSet.mockRejectedValueOnce(new Error("x"));
    await useSettingsStore.getState().patch({ minimizeToTray: true });
    expect(useSettingsStore.getState().minimizeToTray).toBe(false);
  });
});
