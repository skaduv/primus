"use client";

import type { CoreBatch } from "@primus/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { getPlatform, type Platform } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { RpcClient, RpcClosedError, RpcTimeoutError } from "@/rpc/rpc-client";
import { useAppStore } from "@/stores/app-store";
import {
  applyChunks,
  createSessionStore,
  type RecordChunk,
  type SessionState,
  type SessionStore,
} from "@/stores/session-store";

// 一个会话的生命周期：首次发送时打开会话（浏览器预览下由 mock 平台提供假 Core 事件流）。
// 批次先交给 RPC 客户端（id 关联、超时、缺口重建），去重后的记录在 requestAnimationFrame 中
// 一次性合并进 store（第 16.4 节）。

const nextFrame: (cb: () => void) => void =
  typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(() => cb())
    : (cb) => setTimeout(cb, 16);

export interface ChatSession {
  state: SessionState;
  /** 打开会话或发送命令时的错误 */
  error?: string;
  /**
   * 有命令超过 10 秒没有响应（第 7.5 节），界面提示“内核无响应”并提供重启。
   * 期间禁止发送：超时的 prompt 可能已被 Core 受理，重发会多跑一轮。
   */
  unresponsive: boolean;
  /** 发送成功返回 true；失败时设置 error 并返回 false */
  send: (message: string) => Promise<boolean>;
  abort: () => Promise<void>;
  /** 重启内核并重建会话状态 */
  restart: () => Promise<void>;
}

export function useChatSession(): ChatSession {
  const storeRef = useRef<SessionStore>(null);
  storeRef.current ??= createSessionStore();
  const store = storeRef.current;
  const state = useStore(store);
  // 错误来源：超时与重建失败产生的错误在内核恢复或重建成功后自动清除，其他错误保留到下一次操作
  const [error, setErrorState] = useState<{ message: string; kind?: "timeout" | "resync" }>();
  const [unresponsive, setUnresponsive] = useState(false);
  const setError = useCallback((message?: string, kind?: "timeout" | "resync") => {
    setErrorState(message === undefined ? undefined : { message, kind });
  }, []);
  const clearError = useCallback((kind: "timeout" | "resync") => {
    setErrorState((e) => (e?.kind === kind ? undefined : e));
  }, []);
  /** 命令失败时的统一处理；重启或关闭导致的 RpcClosedError 不算错误 */
  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof RpcClosedError) return;
      if (e instanceof RpcTimeoutError) setError(e.message, "timeout");
      else setError(e instanceof Error ? e.message : String(e));
    },
    [setError],
  );

  const conn = useRef<{ platform: Platform; client: RpcClient }>(null);
  const pending = useRef<RecordChunk[]>([]);
  const frameQueued = useRef(false);

  const enqueue = useCallback(
    (chunk: RecordChunk) => {
      pending.current.push(chunk);
      if (frameQueued.current) return;
      frameQueued.current = true;
      nextFrame(() => {
        frameQueued.current = false;
        const chunks = pending.current;
        pending.current = [];
        store.setState((s) => applyChunks(s, chunks), true);
      });
    },
    [store],
  );

  // 正在打开的会话：并发的 send 复用同一个 Promise，避免重复 sessionOpen 泄漏 Core 进程
  const opening = useRef<Promise<void>>(null);
  const disposed = useRef(false);

  const ensureOpen = useCallback((): Promise<void> => {
    if (conn.current) return Promise.resolve();
    opening.current ??= (async () => {
      const platform = await getPlatform();
      // 用输入框上方选中的工作区；未选择时直接对话，不隐式绑定最近的工作区（会话开始后工作区锁定）
      const path = useAppStore.getState().workspace?.path ?? "";
      // 批次可能在 sessionOpen 返回前到达：先缓存，客户端建好后按序交付
      let client: RpcClient | undefined;
      const early: CoreBatch[] = [];
      const onBatch = (batch: CoreBatch) => (client ? client.receive(batch) : early.push(batch));
      const { sessionKey } = await platform.sessionOpen(path, undefined, onBatch);
      if (disposed.current) {
        // 打开期间组件已卸载：立即关闭，避免会话泄漏
        void platform.sessionClose(sessionKey).catch(() => {});
        throw new Error("会话已关闭");
      }
      client = new RpcClient({
        sessionKey,
        send: (record) => platform.coreSend(sessionKey, record),
        onRecords: (records, { gap }) => enqueue({ records, gap }),
        onUnresponsive: () => setUnresponsive(true),
        onResponsive: () => {
          setUnresponsive(false);
          clearError("timeout");
        },
        onResyncError: (e) =>
          setError(
            `${strings.chat.resyncFailed}：${e instanceof Error ? e.message : String(e)}`,
            "resync",
          ),
        onResynced: () => clearError("resync"),
      });
      for (const batch of early) client.receive(batch);
      conn.current = { platform, client };
    })().finally(() => {
      opening.current = null;
    });
    return opening.current;
  }, [enqueue, setError, clearError]);

  // 卸载时关闭会话
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      opening.current = null;
      const c = conn.current;
      conn.current = null;
      if (c) {
        c.client.close();
        void c.platform.sessionClose(c.client.sessionKey).catch(() => {});
      }
    };
  }, []);

  const send = useCallback(
    async (message: string): Promise<boolean> => {
      setError(undefined);
      try {
        await ensureOpen();
        // coreSend 只表示已提交；以 Core 的响应为准（失败原因由 session-store 显示为 lastError）
        const c = conn.current;
        if (!c) throw new Error("会话未打开");
        const res = await c.client.request("prompt", { message });
        return res.success;
      } catch (e) {
        // 超时时 Core 可能已受理（它不按 id 去重）：保留草稿，但由界面在内核恢复或重启前禁止重发
        fail(e);
        return false;
      }
    },
    [ensureOpen, setError, fail],
  );

  const abort = useCallback(async () => {
    const c = conn.current;
    if (!c) return;
    try {
      await c.client.request("abort");
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  const restart = useCallback(async () => {
    const c = conn.current;
    if (!c) return;
    setError(undefined);
    try {
      await c.platform.coreRestart(c.client.sessionKey);
      // 旧进程上等待的命令不会再有响应；新进程按会话文件恢复后重建状态
      c.client.reset();
      setUnresponsive(false);
      await c.client.resync();
    } catch (e) {
      fail(e);
    }
  }, [setError, fail]);

  return { state, error: error?.message, unresponsive, send, abort, restart };
}
