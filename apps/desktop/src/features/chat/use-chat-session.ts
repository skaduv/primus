"use client";

import type { CoreBatch } from "@primus/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { getPlatform, type Platform } from "@/lib/platform";
import { strings } from "@/lib/strings";
import { RpcClient, RpcClosedError, RpcResponseError, RpcTimeoutError } from "@/rpc/rpc-client";
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

/** 错误的界面文案：RPC 层的错误只带结构化字段，文案在这里由 strings 生成 */
function describeError(e: unknown): string {
  if (e instanceof RpcTimeoutError) return strings.chat.responseTimeout;
  if (e instanceof RpcResponseError) return e.reason;
  return e instanceof Error ? e.message : String(e);
}

const nextFrame: (cb: () => void) => void =
  typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(() => cb())
    : (cb) => setTimeout(cb, 16);

export interface ChatSession {
  state: SessionState;
  /** 打开会话或发送命令时的错误 */
  error?: string;
  /**
   * 有命令超过 10 秒没有响应（第 7.5 节），或重启后重建会话状态失败，界面提示“内核无响应”并提供重启。
   * 期间禁止发送：超时的 prompt 可能已被 Core 受理，重发会多跑一轮。
   */
  unresponsive: boolean;
  /** 发送成功返回 true；失败时设置 error 并返回 false */
  send: (message: string) => Promise<boolean>;
  abort: () => Promise<void>;
  /** 正在重启内核：期间重启入口不可用，避免连点重复重启 */
  restarting: boolean;
  /** 重启内核并重建会话状态；进行中再次调用会被忽略 */
  restart: () => Promise<void>;
}

export function useChatSession(): ChatSession {
  const storeRef = useRef<SessionStore>(null);
  storeRef.current ??= createSessionStore();
  const store = storeRef.current;
  const state = useStore(store);
  // 错误来源：超时与重建失败产生的错误在内核恢复或重建成功后自动清除，其他错误保留到下一次操作
  const [error, setErrorState] = useState<{ message: string; kind?: "timeout" | "resync" }>();
  const [unresponsive, setUnresponsiveState] = useState(false);
  // 无响应的两个来源：有命令超时（等它的迟到响应或重启），或重启后重建失败（等之后的重建成功）
  const lock = useRef({ timeout: false, restart: false });
  const syncUnresponsive = useCallback(() => {
    setUnresponsiveState(lock.current.timeout || lock.current.restart);
  }, []);
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
      setError(describeError(e), e instanceof RpcTimeoutError ? "timeout" : undefined);
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
  // 重建失败的代次：推迟的“重建成功”清除只在期间没有新的失败时生效，避免旧的成功清掉新失败的提示
  const resyncFailures = useRef(0);

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
        throw new RpcClosedError();
      }
      client = new RpcClient({
        sessionKey,
        send: (record) => platform.coreSend(sessionKey, record),
        onRecords: (records, { gap }) => enqueue({ records, gap }),
        onUnresponsive: () => {
          lock.current.timeout = true;
          syncUnresponsive();
        },
        onResponsive: () => {
          lock.current.timeout = false;
          syncUnresponsive();
          clearError("timeout");
        },
        onResyncError: (e) => {
          resyncFailures.current += 1;
          setError(`${strings.chat.resyncFailed}：${describeError(e)}`, "resync");
        },
        // 重建的两条 response 随批次排在帧队列里：等它们写入 store 之后再清除重建错误；
        // 若这一帧之前又有一轮重建失败，保留新的失败提示。
        // 重建成功即解除“重启后重建失败”造成的锁定；超时命令造成的锁定仍等其迟到响应
        onResynced: () => {
          lock.current.restart = false;
          syncUnresponsive();
          const failures = resyncFailures.current;
          nextFrame(() => {
            if (resyncFailures.current === failures) clearError("resync");
          });
        },
      });
      for (const batch of early) client.receive(batch);
      conn.current = { platform, client };
    })().finally(() => {
      opening.current = null;
    });
    return opening.current;
  }, [enqueue, setError, clearError, syncUnresponsive]);

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
      // 重建失败的提示保留到重建成功为止
      setErrorState((e) => (e?.kind === "resync" ? e : undefined));
      try {
        await ensureOpen();
        // coreSend 只表示已提交；以 Core 的响应为准（失败原因由 session-store 显示为 lastError）
        const c = conn.current;
        if (!c) throw new Error(strings.chat.sessionNotOpen);
        const res = await c.client.request("prompt", { message });
        return res.success;
      } catch (e) {
        // 超时时 Core 可能已受理（它不按 id 去重）：保留草稿，但由界面在内核恢复或重启前禁止重发
        fail(e);
        return false;
      }
    },
    [ensureOpen, fail],
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

  // 同步的重入保护（state 要到下一次渲染才生效）；restarting 只用于界面禁用按钮
  const restartingRef = useRef(false);
  const [restarting, setRestarting] = useState(false);
  const restart = useCallback(async () => {
    const c = conn.current;
    if (!c || restartingRef.current) return;
    restartingRef.current = true;
    setRestarting(true);
    setError(undefined);
    try {
      await c.platform.coreRestart(c.client.sessionKey);
      // 旧进程上等待的命令不会再有响应；新进程按会话文件恢复后重建状态
      c.client.reset();
      lock.current.timeout = false;
      // 重建成功前不解除发送限制：失败时保留重建错误与“重启内核”入口
      const ok = await c.client.resync();
      lock.current.restart = !ok;
      syncUnresponsive();
    } catch (e) {
      fail(e);
    } finally {
      restartingRef.current = false;
      setRestarting(false);
    }
  }, [setError, fail, syncUnresponsive]);

  return { state, error: error?.message, unresponsive, send, abort, restarting, restart };
}
