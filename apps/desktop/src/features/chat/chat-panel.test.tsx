import type { CoreBatch } from "@primus/protocol";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatformForTesting } from "@/lib/platform";
import { createMockPlatform } from "@/lib/platform/mock";
import { strings } from "@/lib/strings";
import { initialAppState, useAppStore } from "@/stores/app-store";
import { ChatPanel } from "./chat-panel";

const t = strings.chat;

describe("对话区（mock 事件流）", () => {
  beforeEach(() => setPlatformForTesting(createMockPlatform({ intervalMs: 1, batchSize: 50 })));
  afterEach(() => {
    setPlatformForTesting(undefined);
    useAppStore.setState(initialAppState);
  });

  it("未选择工作区时输入框上方显示选择文件夹；选好后收起并在工具栏显示工作区", async () => {
    render(<ChatPanel />);
    const bar = screen.getByRole("button", { name: new RegExp(t.chooseFolder) });
    fireEvent.keyDown(bar, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /示例工作区/ }));
    await waitFor(() => expect(useAppStore.getState().workspace?.name).toBe("示例工作区"));
    expect(screen.queryByRole("button", { name: new RegExp(t.chooseFolder) })).toBeNull();
    expect(screen.getByRole("button", { name: /示例工作区/ })).toBeTruthy();
  });

  it("发送消息后流式显示回答，结束后恢复发送按钮", async () => {
    render(<ChatPanel />);
    expect(screen.getByText(t.previewBadge)).toBeTruthy();

    const input = screen.getByRole("textbox", { name: t.inputLabel });
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // 发送成功后才清空输入
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
    await screen.findByRole("article", { name: t.you });
    await waitFor(() => expect(screen.getByText(/mock 平台/)).toBeTruthy());
    expect(screen.getByText(/工具：read/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: t.send })).toBeTruthy());
  });

  it("Core 拒绝 prompt 时显示错误并保留草稿", async () => {
    const base = createMockPlatform({ intervalMs: 1, batchSize: 50 });
    let deliver: ((b: CoreBatch) => void) | undefined;
    setPlatformForTesting({
      ...base,
      sessionOpen: async (_path, _model, onBatch) => {
        deliver = onBatch;
        return { sessionKey: "k" } as Awaited<ReturnType<typeof base.sessionOpen>>;
      },
      coreSend: async (sessionKey, record) => {
        deliver?.({
          sessionKey,
          seq: 1,
          dropped: 0,
          records: [
            {
              type: "response",
              id: record.id,
              command: record.type,
              success: false,
              error: "拒绝",
            },
          ],
        });
      },
    });
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: t.inputLabel });
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe("你好");
  });

  it("命令 10 秒无响应时提示内核无响应，重启内核后恢复", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let stalled = true;
      const base = createMockPlatform({
        intervalMs: 1,
        batchSize: 50,
        stallCommand: (cmd) => stalled && cmd.type === "prompt",
      });
      const coreRestart = vi.fn(async () => {
        stalled = false;
      });
      const coreSend = vi.fn(base.coreSend);
      setPlatformForTesting({ ...base, coreSend, coreRestart });
      render(<ChatPanel />);
      const input = screen.getByRole("textbox", { name: t.inputLabel });
      fireEvent.change(input, { target: { value: "你好" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await vi.advanceTimersByTimeAsync(10_000);
      expect(await screen.findByText(t.unresponsive)).toBeTruthy();
      // 超时提示来自集中管理的文案，不显示原始命令名
      expect(screen.getByText(t.responseTimeout)).toBeTruthy();
      expect((input as HTMLTextAreaElement).value).toBe("你好"); // 保留草稿
      // 超时的 prompt 可能已被受理：恢复前禁止重发
      const sendButton = screen.getByRole("button", { name: t.send }) as HTMLButtonElement;
      expect(sendButton.disabled).toBe(true);
      const sentBefore = coreSend.mock.calls.length;
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.click(sendButton);
      await vi.advanceTimersByTimeAsync(0);
      expect(coreSend).toHaveBeenCalledTimes(sentBefore);
      expect(coreSend.mock.calls.filter(([, r]) => r.type === "prompt")).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: t.restartCore }));
      await waitFor(() => expect(coreRestart).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByText(t.unresponsive)).toBeNull());
      // 重启不留下错误提示，可以再次发送
      expect(screen.queryByRole("alert")).toBeNull();
      expect(sendButton.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("重启进行中按钮禁用，连点只重启一次", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let stalled = true;
      const base = createMockPlatform({
        intervalMs: 1,
        batchSize: 50,
        stallCommand: (cmd) => stalled && cmd.type === "prompt",
      });
      let finishRestart: (() => void) | undefined;
      const coreRestart = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishRestart = () => {
              stalled = false;
              resolve();
            };
          }),
      );
      setPlatformForTesting({ ...base, coreRestart });
      render(<ChatPanel />);
      const input = screen.getByRole("textbox", { name: t.inputLabel });
      fireEvent.change(input, { target: { value: "你好" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await vi.advanceTimersByTimeAsync(10_000);
      const restartButton = (await screen.findByRole("button", {
        name: t.restartCore,
      })) as HTMLButtonElement;

      fireEvent.click(restartButton);
      fireEvent.click(restartButton);
      await waitFor(() => expect(restartButton.disabled).toBe(true));
      fireEvent.click(restartButton);
      expect(coreRestart).toHaveBeenCalledTimes(1);

      finishRestart?.();
      await waitFor(() => expect(screen.queryByText(t.unresponsive)).toBeNull());
      expect(coreRestart).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("重启后重建失败保持无响应，之后缺口触发的重建成功即解除锁定", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const base = createMockPlatform({ intervalMs: 1, batchSize: 50 });
      let deliver: ((b: CoreBatch) => void) | undefined;
      let seq = 0;
      let phase: "stall" | "failResync" | "ok" = "stall";
      const respond = (sessionKey: string, id: string, command: string, success: boolean) => {
        seq += 1;
        deliver?.({
          sessionKey,
          seq,
          dropped: 0,
          records: [
            success
              ? { type: "response", id, command, success: true, data: {} }
              : { type: "response", id, command, success: false, error: "未就绪" },
          ] as CoreBatch["records"],
        });
      };
      const coreRestart = vi.fn(async () => {
        phase = "failResync";
      });
      setPlatformForTesting({
        ...base,
        coreRestart,
        sessionOpen: async (_path, _model, onBatch) => {
          deliver = onBatch;
          return { sessionKey: "k" } as Awaited<ReturnType<typeof base.sessionOpen>>;
        },
        coreSend: async (sessionKey, record) => {
          const { id, type } = record as { id: string; type: string };
          if (phase === "stall") return;
          queueMicrotask(() => respond(sessionKey, id, type, phase === "ok"));
        },
      });
      render(<ChatPanel />);
      const input = screen.getByRole("textbox", { name: t.inputLabel });
      fireEvent.change(input, { target: { value: "你好" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await screen.findByText(t.unresponsive)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: t.restartCore }));
      await waitFor(() => expect(coreRestart).toHaveBeenCalledTimes(1));
      // 重建失败：仍提示无响应，禁止发送
      expect(await screen.findByText(new RegExp(t.resyncFailed))).toBeTruthy();
      const sendButton = screen.getByRole("button", { name: t.send }) as HTMLButtonElement;
      expect(screen.getByText(t.unresponsive)).toBeTruthy();
      expect(sendButton.disabled).toBe(true);

      // 之后出现缺口，重建成功：解除锁定并清除重建错误
      phase = "ok";
      seq += 5;
      deliver?.({ sessionKey: "k", seq, dropped: 0, records: [] });
      await waitFor(() => expect(screen.queryByText(t.unresponsive)).toBeNull());
      await waitFor(() => expect(screen.queryByText(new RegExp(t.resyncFailed))).toBeNull());
      expect(sendButton.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Shift+Enter 不发送；空内容不能发送", () => {
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: t.inputLabel });
    expect((screen.getByRole("button", { name: t.send }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "第一行" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect((input as HTMLTextAreaElement).value).toBe("第一行");
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("附件只引用本地路径：选中后显示文件名，可移除，单独附件也能发送", async () => {
    render(<ChatPanel />);
    fireEvent.click(await screen.findByRole("button", { name: t.attach }));
    expect(await screen.findByText("README.md")).toBeTruthy();
    expect(screen.getByText("main.ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `${t.removeAttachment} main.ts` }));
    expect(screen.queryByText("main.ts")).toBeNull();
    expect((screen.getByRole("button", { name: t.send }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("权限菜单接入 Core 前只开放每次询问，其余档位禁用", async () => {
    render(<ChatPanel />);
    const trigger = screen.getByRole("button", { name: new RegExp(t.permissionMode) });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const full = await screen.findByRole("menuitemradio", {
      name: new RegExp(t.permissions.full.label),
    });
    expect(full.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(full);
    expect(useAppStore.getState().permissionMode).toBe("ask");
  });

  it("运行中可以停止", async () => {
    setPlatformForTesting(createMockPlatform({ intervalMs: 20, batchSize: 2 }));
    render(<ChatPanel />);
    const input = screen.getByRole("textbox", { name: t.inputLabel });
    fireEvent.change(input, { target: { value: "长任务" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: t.stop }));
    await waitFor(() => expect(screen.getByRole("button", { name: t.send })).toBeTruthy());
    expect(screen.queryByText(/mock 平台/)).toBeNull();
  });

  it("时间线按悬浮输入框的实测高度留出底部空间，欢迎页不被遮挡", () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const h = this.querySelector("form") ? 150 : 0;
        return { height: h, width: 0, top: 0, left: 0, right: 0, bottom: h, x: 0, y: 0 } as DOMRect;
      });
    try {
      render(<ChatPanel />);
      const scroller = screen
        .getByRole("heading", { name: t.welcomeTitle })
        .closest(".overflow-y-auto") as HTMLElement;
      // 输入框 150px + 间距 16px
      expect(scroller.style.paddingBottom).toBe("166px");
    } finally {
      spy.mockRestore();
    }
  });
});
