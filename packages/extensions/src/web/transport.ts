// web_fetch 的传输（ADR 0020）：用 node:http / node:https 发请求，连接的地址就是检查过的地址（防 DNS 重绑定）。
// `checkPublicUrl` 的预检查与实际连接是两次独立的 DNS 解析，只做预检查挡不住 DNS 重绑定。
// - 直连：在建立连接时用 `guardedLookup` 解析并检查，解析到本机或内网地址就拒绝这次连接。
// - 走代理（与 Core 一样认 HTTP(S)_PROXY / NO_PROXY）：本地解析并检查后，用 CONNECT 让代理连到这个 IP，
//   再在隧道里按原域名做 TLS（SNI 与证书校验用域名），代理不再自己解析域名。只支持 http:// 代理。

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import { isIP, type LookupFunction, type Socket } from "node:net";
import { pipeline, Readable } from "node:stream";
import * as tls from "node:tls";
import * as zlib from "node:zlib";
import { isPrivateAddress, PRIVATE_ADDRESS_MESSAGE, WebError } from "./net.ts";

type Env = Record<string, string | undefined>;
/** DNS 解析函数（与 `dns.lookup` 同形；测试可替换） */
export type Lookup = typeof dnsLookup;

const envOf = (env: Env, name: string): string =>
  (env[name] ?? env[name.toLowerCase()] ?? "").trim();

/** 主机是否命中 NO_PROXY（逗号或空白分隔；`*` 全部；`example.com` / `.example.com` 含子域名；可带端口） */
export function bypassProxy(host: string, port: string, env: Env): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  for (const raw of envOf(env, "NO_PROXY").split(/[\s,]+/)) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === "*") return true;
    const m = /^(?:\[([^\]]+)\]|([^:]+))(?::(\d+))?$/.exec(entry.replace(/^\*?\./, ""));
    const name = m?.[1] ?? m?.[2];
    if (!name || (m?.[3] && m[3] !== port)) continue;
    if (h === name || h.endsWith(`.${name}`)) return true;
  }
  return false;
}

/** 连不上代理本身（端口没有进程监听、主机不可达等）：代理软件已退出但系统代理设置还留着时出现，改为直连 */
export class ProxyUnreachableError extends Error {
  constructor(cause: unknown) {
    super(`无法连接代理：${(cause as Error)?.message ?? String(cause)}`, { cause });
    this.name = "ProxyUnreachableError";
  }
}

/** 这个网址要用的代理（与 undici EnvHttpProxyAgent 一致：https 先认 HTTPS_PROXY，再退回 HTTP_PROXY）；不用代理时返回 undefined */
export function proxyFor(url: URL, env: Env): URL | undefined {
  const raw =
    url.protocol === "https:"
      ? envOf(env, "HTTPS_PROXY") || envOf(env, "HTTP_PROXY")
      : envOf(env, "HTTP_PROXY");
  if (!raw) return undefined;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (bypassProxy(url.hostname, port, env)) return undefined;
  let proxy: URL;
  try {
    proxy = new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch {
    throw new WebError("代理设置无效，无法读取网页");
  }
  if (proxy.protocol !== "http:") throw new WebError("只支持 http:// 代理，无法读取网页");
  if (proxy.username || proxy.password) {
    try {
      decodeURIComponent(proxy.username);
      decodeURIComponent(proxy.password);
    } catch {
      throw new WebError("代理设置无效，无法读取网页");
    }
  }
  return proxy;
}

/** 连接时用的 DNS 解析：任何一个地址落在 `blocked` 里就拒绝这次连接 */
export function guardedLookup(
  blocked: (ip: string) => boolean = isPrivateAddress,
  lookupImpl: Lookup = dnsLookup,
): LookupFunction {
  return ((hostname, options, callback) => {
    lookupImpl(hostname, options, (err, address, family) => {
      if (err) return callback(err, address as string, family);
      const list = Array.isArray(address)
        ? (address as LookupAddress[]).map((a) => a.address)
        : [address as string];
      if (list.some(blocked))
        return callback(new WebError(PRIVATE_ADDRESS_MESSAGE), address as string, family);
      callback(null, address as string, family);
    });
  }) as LookupFunction;
}

/** 解析并检查一个主机，返回要连接的 IP（IP 字面量直接检查） */
function resolveChecked(
  host: string,
  blocked: (ip: string) => boolean,
  lookupImpl: Lookup,
): Promise<string> {
  const h = host.replace(/^\[|\]$/g, "");
  if (isIP(h)) {
    return blocked(h) ? Promise.reject(new WebError(PRIVATE_ADDRESS_MESSAGE)) : Promise.resolve(h);
  }
  return new Promise((resolve, reject) => {
    guardedLookup(blocked, lookupImpl)(h, { all: false }, (err, address) => {
      if (err) reject(err);
      else resolve(address as string);
    });
  });
}

/**
 * 经 http 代理建隧道到已检查的 IP；https 在隧道里按原域名做 TLS。
 * 解析阶段外层请求还没有 socket，Node 的中止只会记下错误，所以这里自己听 `signal`：
 * 中止时立即以错误结束；解析迟到返回也不再发 CONNECT。
 */
function tunnel(
  target: URL,
  proxy: URL,
  blocked: (ip: string) => boolean,
  signal: AbortSignal | undefined,
  lookupImpl: Lookup,
  tlsOptions: TlsOptions,
): (opts: unknown, done: (err: Error | null, socket?: Socket) => void) => undefined {
  return (_opts, done) => {
    const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
    let settled = false;
    const onAbort = () => finish(asError(signal?.reason ?? new Error("aborted")));
    const finish = (err: Error | null, socket?: Socket) => {
      if (settled) {
        socket?.destroy();
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      done(err, socket);
    };
    if (signal?.aborted) {
      onAbort();
      return undefined;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    const secure = target.protocol === "https:";
    const port = target.port || (secure ? "443" : "80");
    resolveChecked(target.hostname, blocked, lookupImpl)
      .then((ip) => {
        if (settled) return;
        const authority = `${isIP(ip) === 6 ? `[${ip}]` : ip}:${port}`;
        const headers: Record<string, string> = { Host: authority };
        if (proxy.username || proxy.password) {
          let cred: string;
          try {
            cred = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
          } catch {
            finish(new WebError("代理设置无效，无法读取网页"));
            return;
          }
          headers["Proxy-Authorization"] = `Basic ${Buffer.from(cred).toString("base64")}`;
        }
        const req = http.request({
          host: proxy.hostname.replace(/^\[|\]$/g, ""),
          port: proxy.port || "80",
          method: "CONNECT",
          path: authority,
          headers,
          signal,
        });
        req.once("connect", (res, socket) => {
          if (res.statusCode !== 200) {
            socket.destroy();
            finish(new WebError(`代理拒绝了连接（HTTP ${res.statusCode}）`));
            return;
          }
          if (!secure) {
            finish(null, socket);
            return;
          }
          const host = target.hostname.replace(/^\[|\]$/g, "");
          try {
            const secured = tls.connect({
              ...tlsOptions,
              socket,
              ...(isIP(host) ? {} : { servername: host }),
              host,
              ALPNProtocols: ["http/1.1"],
            });
            finish(null, secured);
          } catch (e) {
            socket.destroy();
            finish(asError(e));
          }
        });
        // CONNECT 请求本身出错（还没收到代理的应答）：连不上代理，交给调用方改为直连
        req.once("error", (e) => finish(signal?.aborted ? e : new ProxyUnreachableError(e)));
        req.end();
      })
      .catch((e: unknown) => finish(asError(e)));
    return undefined;
  };
}

/** 按 Content-Encoding 解压；不认识的编码原样返回。任何一段关闭或出错，整条流（含未读完的响应）一起销毁 */
function decoded(res: http.IncomingMessage): Readable {
  const enc = String(res.headers["content-encoding"] ?? "")
    .trim()
    .toLowerCase();
  const z =
    enc === "gzip" || enc === "x-gzip"
      ? zlib.createGunzip()
      : enc === "deflate"
        ? zlib.createInflate()
        : enc === "br"
          ? zlib.createBrotliDecompress()
          : undefined;
  if (!z) return res;
  pipeline(res, z, () => undefined);
  return z;
}

/**
 * 走代理时的请求选项。自定义 `createConnection` 不经过 Agent，Node 拿不到协议的默认端口，
 * 会按 80 生成 Host（https 变成 `host:80`）；这里按协议给 `defaultPort`，显式的非默认端口照常保留。
 */
export function proxiedOptions(
  url: URL,
  base: https.RequestOptions,
  createConnection: unknown,
): https.RequestOptions {
  return {
    ...base,
    defaultPort: url.protocol === "https:" ? 443 : 80,
    createConnection: createConnection as https.RequestOptions["createConnection"],
  };
}

/** 建立 TLS 时附加的选项（如 `maxVersion`）；直连与代理隧道里都生效 */
export type TlsOptions = Pick<tls.ConnectionOptions, "maxVersion" | "minVersion">;

/**
 * 与 `fetch` 同形的请求（只用到 method、headers、字符串 body、signal，不跟随跳转）。
 * `blocked`、`env`、`lookupImpl` 与 `tlsOptions` 供调用方与测试替换。
 */
export function createDirectFetch(
  blocked: (ip: string) => boolean = isPrivateAddress,
  env: Env = process.env,
  lookupImpl: Lookup = dnsLookup,
  tlsOptions: TlsOptions = {},
): typeof fetch {
  const lookup = guardedLookup(blocked, lookupImpl);
  return ((input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const mod = url.protocol === "https:" ? https : http;
    const method = init.method ?? "GET";
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      "Accept-Encoding": "gzip, deflate, br",
    };
    const signal = init.signal ?? undefined;
    if (init.body != null && typeof init.body !== "string")
      return Promise.reject(new TypeError("只支持字符串请求体"));
    const body = init.body ?? undefined;
    if (body !== undefined) headers["Content-Length"] = String(Buffer.byteLength(body));
    let proxy: URL | undefined;
    try {
      proxy = proxyFor(url, env);
    } catch (e) {
      return Promise.reject(e);
    }
    // 代理连不上时（代理软件已退出，系统代理设置或 Core 启动时拿到的代理变量还在）改为直连再试一次
    return send(proxy).catch((e: unknown) => {
      if (proxy && e instanceof ProxyUnreachableError && !signal?.aborted) return send(undefined);
      throw e;
    });

    function send(via: URL | undefined): Promise<Response> {
      return new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const options: https.RequestOptions = via
          ? proxiedOptions(
              url,
              { method, headers, signal },
              tunnel(url, via, blocked, signal, lookupImpl, tlsOptions),
            )
          : { ...tlsOptions, method, headers, signal, lookup };
        const req = mod.request(url, options, (res) => {
          const status = res.statusCode ?? 0;
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue;
            if (Array.isArray(v)) for (const x of v) h.append(k, x);
            else h.set(k, String(v));
          }
          // 204 / 205 / 304 与 HEAD 没有正文；给它们非空流会被 Response 构造器拒绝
          const noBody = status === 204 || status === 205 || status === 304 || method === "HEAD";
          let resBody: ReadableStream | null = null;
          if (noBody) res.resume();
          else {
            const stream = decoded(res);
            if (stream !== res) {
              h.delete("content-encoding");
              h.delete("content-length");
            }
            resBody = Readable.toWeb(stream) as ReadableStream;
          }
          try {
            resolve(
              new Response(resBody, { status, statusText: res.statusMessage ?? "", headers: h }),
            );
          } catch (e) {
            res.destroy();
            reject(e);
          }
        });
        // HTTP 101 协议升级：Node 不会调用响应回调，也不会触发 error；不处理的话 Promise 永远等待
        req.on("upgrade", (res, socket) => {
          socket.destroy();
          res.destroy();
          reject(new WebError(`网页要求协议升级（HTTP ${res.statusCode ?? 101}），不支持读取`));
        });
        req.on("error", reject);
        req.end(body);
      });
    }
  }) as typeof fetch;
}

/** web_fetch 默认用的请求 */
export function pageFetch(): typeof fetch {
  return createDirectFetch();
}

/**
 * web_search 用的请求：不走 Core 的全局 fetch（undici），改用 node:https 并把 TLS 限制在 1.2。
 * Node 24（OpenSSL 3.5）的 TLS 1.3 默认握手（含后量子密钥交换，ClientHello 明显变大）在部分网络链路上
 * 连 api.langsearch.com 会被中断，表现为约 11 秒后连接重置/超时，搜索一直“无法连接搜索服务”；
 * 同一请求以 TLS 1.2 握手立即返回 200。搜索地址是内置的固定服务，不做内网地址拦截（兼容代理软件的 fake-ip）；
 * 代理设置与 Core 一致（HTTP(S)_PROXY / NO_PROXY）。
 */
export function searchFetch(env: Env = process.env): typeof fetch {
  return createDirectFetch(() => false, env, dnsLookup, { maxVersion: "TLSv1.2" });
}
