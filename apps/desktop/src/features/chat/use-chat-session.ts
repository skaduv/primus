"use client";

import type { CoreBatch, RpcCommand } from "@primus/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { getPlatform, type Platform } from "@/lib/platform";
import { useAppStore } from "@/stores/app-store";
import {
  applyBatches,
  createSessionStore,
  type SessionState,
  type SessionStore,
} from "@/stores/session-store";

// 一个会话的生命周期：首次发送时打开会话（浏览器预览下由 mock 平台提供假 Core 事件流），
// 薄壳推来的批次先缓存，在 requestAnimationFrame 中一次性合并进 store（第 16.4 节）。

const nextFrame: (cb: () => void) => void =
  typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(() => cb())
    : (cb) => setTimeout(cb, 16);

export interface ChatSession {
  state: SessionState;
  /** 打开会话或发送命令时的错误 */
  error?: string;
  send: (message: string) => Promise<void>;
  abort: () => Promise<void>;
}

export function useChatSession(): ChatSession {
  const storeRef = useRef<SessionStore>(null);
  storeRef.current ??= createSessionStore();
  const store = storeRef.current;
  const state = useStore(store);
  const [error, setError] = useState<string>();

  const conn = useRef<{ platform: Platform; sessionKey: string; nextId: number }>(null);
  const pending = useRef<CoreBatch[]>([]);
  const frameQueued = useRef(false);

  const onBatch = useCallback(
    (batch: CoreBatch) => {
      pending.current.push(batch);
      if (frameQueued.current) return;
      frameQueued.current = true;
      nextFrame(() => {
        frameQueued.current = false;
        const batches = pending.current;
        pending.current = [];
        store.setState((s) => applyBatches(s, batches), true);
      });
    },
    [store],
  );

  const command = useCallback(async (type: string, fields: Record<string, unknown> = {}) => {
    const c = conn.current;
    if (!c) return;
    const record: RpcCommand = { id: `${c.sessionKey}-${c.nextId++}`, type, ...fields };
    await c.platform.coreSend(c.sessionKey, record);
  }, []);

  // 正在打开的会话：并发的 send 复用同一个 Promise，避免重复 sessionOpen 泄漏 Core 进程
  const opening = useRef<Promise<void>>(null);
  const disposed = useRef(false);

  const ensureOpen = useCallback((): Promise<void> => {
    if (conn.current) return Promise.resolve();
    opening.current ??= (async () => {
      const platform = await getPlatform();
      // 用输入框上方选中的工作区；未选择时直接对话，不隐式绑定最近的工作区（会话开始后工作区锁定）
      const path = useAppStore.getState().workspace?.path ?? "";
      const { sessionKey } = await platform.sessionOpen(path, undefined, onBatch);
      if (disposed.current) {
        // 打开期间组件已卸载：立即关闭，避免会话泄漏
        void platform.sessionClose(sessionKey).catch(() => {});
        throw new Error("会话已关闭");
      }
      conn.current = { platform, sessionKey, nextId: 1 };
    })().finally(() => {
      opening.current = null;
    });
    return opening.current;
  }, [onBatch]);

  // 缺号时用完整历史重建
  useEffect(() => {
    if (state.needsResync) void command("get_messages").catch(() => {});
  }, [state.needsResync, command]);

  // 卸载时关闭会话
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      opening.current = null;
      const c = conn.current;
      conn.current = null;
      if (c) void c.platform.sessionClose(c.sessionKey).catch(() => {});
    };
  }, []);

  const send = useCallback(
    async (message: string) => {
      setError(undefined);
      try {
        await ensureOpen();
        await command("prompt", { message });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [ensureOpen, command],
  );

  const abort = useCallback(async () => {
    try {
      await command("abort");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [command]);

  return { state, error, send, abort };
}
