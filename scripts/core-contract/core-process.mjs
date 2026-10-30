// RPC 契约测试的 Core 进程封装：按薄壳的方式拉起 Core（技术方案第 4.4 节），stdin 写命令，stdout 按 JSONL 读记录。
//
// 分帧与薄壳一致（AGENTS.md 第 5 节、rpc.md「Framing」）：只按 LF 切分并去掉行尾 CR；不用 readline，
// 它会把 JSON 字符串里合法的 U+2028 / U+2029 当成换行。
import { spawn } from "node:child_process";

/** 增量 JSONL 解码：push 字节块，返回本次凑齐的完整行（已去掉行尾 CR，按 UTF-8 解码） */
export class JsonlDecoder {
  #pending = Buffer.alloc(0);

  push(chunk) {
    const data = this.#pending.length ? Buffer.concat([this.#pending, chunk]) : chunk;
    const lines = [];
    let start = 0;
    for (let i = data.indexOf(0x0a); i !== -1; i = data.indexOf(0x0a, start)) {
      let end = i;
      if (end > start && data[end - 1] === 0x0d) end -= 1;
      lines.push(data.toString("utf8", start, end));
      start = i + 1;
    }
    this.#pending = data.subarray(start);
    return lines;
  }

  /** 流结束时尚未以 LF 结尾的残余字节数（正常应为 0） */
  get pendingBytes() {
    return this.#pending.length;
  }

  /** 取出残余字节（按 UTF-8 解码）并清空 */
  flush() {
    const rest = this.#pending.toString("utf8");
    this.#pending = Buffer.alloc(0);
    return rest;
  }
}

export class CoreProcess {
  /** 收到的全部 stdout 记录（解析后的 JSON），按到达顺序 */
  records = [];
  /** 不是合法 JSON 的 stdout 行：协议要求 stdout 只有协议记录，出现即违反契约 */
  invalidLines = [];
  stderr = "";
  /** 进程已退出（或运行时无法启动） */
  exited = false;
  exitCode = null;
  /** stdout 已结束：之后不会再有新记录 */
  stdoutEnded = false;

  #child;
  #nextId = 1;
  #waiters = new Set();
  #exitPromise;
  #stdoutEndPromise;

  constructor({ nodeExe, entry, args = [], cwd, env }) {
    this.#child = spawn(nodeExe, [entry, ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const decoder = new JsonlDecoder();
    this.#child.stdout.on("data", (chunk) => {
      for (const line of decoder.push(chunk)) this.#onLine(line);
    });
    // 每条记录都必须以 LF 结尾：stdout 结束时的残余算作非法行。
    // exit 事件可能早于 stdout 读完（Node.js child_process 文档），所以等待者以「退出且 stdout 结束」为终点。
    this.#stdoutEndPromise = new Promise((resolve) => {
      const onEnd = () => {
        if (this.stdoutEnded) return;
        this.stdoutEnded = true;
        if (decoder.pendingBytes > 0) this.invalidLines.push(decoder.flush());
        this.#notify();
        resolve();
      };
      this.#child.stdout.once("end", onEnd);
      this.#child.stdout.once("close", onEnd);
      this.#child.once("error", onEnd); // 运行时无法启动时 stdout 不会有数据
    });
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (d) => {
      this.stderr += d;
    });
    this.#exitPromise = new Promise((resolve) => {
      const onExit = (code) => {
        if (this.exited) return;
        this.exited = true;
        this.exitCode = code;
        this.#notify();
        resolve(code);
      };
      this.#child.once("exit", onExit);
      // 运行时无法启动（如路径错误）时不会有 exit 事件
      this.#child.once("error", (err) => {
        this.stderr += `启动 Core 失败：${err.message}\n`;
        onExit(null);
      });
    });
    this.#child.stdin.on("error", () => {}); // 进程提前退出时写入失败，由 exited 检查报告
  }

  // 空行也按 JSON 解析（失败即记入 invalidLines）：协议要求 stdout 每行都是一条记录
  #onLine(line) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      this.invalidLines.push(line);
      return;
    }
    this.records.push(record);
    this.#notify();
  }

  #notify() {
    for (const check of [...this.#waiters]) check();
  }

  /** 写一条命令（自动分配 id），返回 id */
  send(command) {
    const id = command.id ?? `contract-${this.#nextId++}`;
    this.#child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    return id;
  }

  /**
   * 等到某条记录满足 predicate（含已经到达的记录，从 fromIndex 开始找），返回该记录。
   * 超时或进程退出时抛错，错误信息带上 label 与 Core 的 stderr。
   */
  waitFor(predicate, { label, timeoutMs = 15_000, fromIndex = 0 } = {}) {
    return new Promise((resolve, reject) => {
      let index = fromIndex;
      let timer;
      const check = () => {
        for (; index < this.records.length; index++) {
          const record = this.records[index];
          if (predicate(record)) {
            done();
            resolve(record);
            return;
          }
        }
        // 进程退出后 stdout 里可能还有没读完的记录：等 stdout 也结束才判定等不到
        if (this.exited && this.stdoutEnded) {
          done();
          reject(new Error(`等待 ${label} 时 Core 进程退出（退出码 ${this.exitCode}）`));
        }
      };
      const done = () => {
        clearTimeout(timer);
        this.#waiters.delete(check);
      };
      timer = setTimeout(() => {
        done();
        reject(new Error(`${timeoutMs / 1000} 秒内未等到 ${label}`));
      }, timeoutMs);
      this.#waiters.add(check);
      check();
    });
  }

  /** 发送命令并等待同 id 的 response */
  async request(command, options = {}) {
    const id = this.send(command);
    return this.waitFor((r) => r.type === "response" && r.id === id, {
      label: `${command.type} 的 response`,
      ...options,
    });
  }

  /**
   * 不关闭 stdin，直接 SIGKILL 结束进程（模拟薄壳重启时的强制结束），返回退出码（被强制结束时为 null）。
   * 之后同 stop 等 stdout 读完（最多 drainMs）。已退出时直接返回记录的退出码。
   */
  async kill({ drainMs = 2_000 } = {}) {
    if (!this.exited) {
      this.#child.kill("SIGKILL");
      await this.#exitPromise;
    }
    return this.stop({ drainMs });
  }

  /**
   * 关闭 stdin 请求有序退出（rpc.md「Shutdown」），返回退出码。timeoutMs 内未退出则发 SIGTERM，
   * 再过 killGraceMs 仍未退出（如忽略了 SIGTERM）则发 SIGKILL；被强制结束时退出码为 null。
   * 退出后再等 stdout 读完（最多 drainMs：Core 的子进程若仍持有管道，stdout 可能迟迟不结束），
   * 这样残余行已计入 invalidLines；调用方据 stdoutEnded 判断非法行检查是否完整。
   * 可重复调用，已退出时直接返回记录的退出码。
   */
  async stop({ timeoutMs = 5_000, killGraceMs = 2_000, drainMs = 2_000 } = {}) {
    if (!this.exited) {
      this.#child.stdin.end();
      const timers = [
        setTimeout(() => this.#child.kill("SIGTERM"), timeoutMs),
        setTimeout(() => this.#child.kill("SIGKILL"), timeoutMs + killGraceMs),
      ];
      await this.#exitPromise;
      for (const timer of timers) clearTimeout(timer);
    }
    if (!this.stdoutEnded) {
      let timer;
      await Promise.race([
        this.#stdoutEndPromise,
        new Promise((resolve) => {
          timer = setTimeout(resolve, drainMs);
        }),
      ]);
      clearTimeout(timer);
    }
    return this.exitCode;
  }
}
