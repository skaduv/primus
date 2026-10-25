import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPlatformForTesting } from "@/lib/platform";
import { createMockPlatform } from "@/lib/platform/mock";
import { strings } from "@/lib/strings";
import { ChatPanel } from "./chat-panel";

const t = strings.chat;

describe("对话区（mock 事件流）", () => {
  beforeEach(() => setPlatformForTesting(createMockPlatform({ intervalMs: 1, batchSize: 50 })));
  afterEach(() => setPlatformForTesting(undefined));

  it("发送消息后流式显示回答，结束后恢复发送按钮", async () => {
    render(<ChatPanel />);
    expect(screen.getByText(t.previewBadge)).toBeTruthy();

    const input = screen.getByRole("textbox", { name: t.inputLabel });
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect((input as HTMLTextAreaElement).value).toBe("");
    await screen.findByRole("article", { name: t.you });
    await waitFor(() => expect(screen.getByText(/mock 平台/)).toBeTruthy());
    expect(screen.getByText(/工具：read/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: t.send })).toBeTruthy());
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
});
