import { afterEach, describe, expect, it } from "vitest";
import { getPlatform, isTauriRuntime, setPlatformForTesting } from "./index";

describe("平台选择", () => {
  afterEach(() => {
    setPlatformForTesting(undefined);
    delete (globalThis as { isTauri?: boolean }).isTauri;
  });

  it("浏览器中（无 Tauri 注入）使用 mock 实现，且为单例", async () => {
    expect(isTauriRuntime()).toBe(false);
    const p = await getPlatform();
    await expect(p.appInfo()).resolves.toMatchObject({ runtime: "mock" });
    expect(await getPlatform()).toBe(p);
  });

  it("识别 Tauri 2 注入的 isTauri 标记", () => {
    (globalThis as { isTauri?: boolean }).isTauri = true;
    expect(isTauriRuntime()).toBe(true);
  });
});
