import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createServer as createNetServer, connect as netConnect } from "node:net";
import { gzipSync } from "node:zlib";
import { WEBFETCH_TOOL, WEBSEARCH_TOOL } from "@primus/protocol";
import { describe, expect, it, vi } from "vitest";
import { findInText, MAX_FIND_CHARS, normalizeFetch, runFetch, textVersion } from "./fetch.ts";
import {
  decodeEntities,
  htmlTitle,
  htmlToMarkdown,
  MAX_HREF_CHARS,
  MAX_LINK_CHARS,
} from "./html.ts";
import web, {
  createWeb,
  localDate,
  PROMPT_SECTION,
  type PromptOptions,
  SEARCH_SECRET_ID,
  syncActiveTools,
  type WebDeps,
} from "./index.ts";
import { checkPublicUrl, isPrivateAddress, WebError, wrapExternal } from "./net.ts";
import {
  formatResults,
  KeyPool,
  MAX_RESULT_CHARS,
  MAX_SUMMARY_CHARS,
  normalizeSearch,
  parseResults,
} from "./search.ts";
import {
  createDirectFetch,
  type Lookup,
  proxiedOptions,
  proxyFor,
  searchFetch,
} from "./transport.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const searchOk = (n = 2) =>
  json(200, {
    code: 200,
    msg: null,
    data: {
      webPages: {
        value: Array.from({ length: n }, (_, i) => ({
          name: `标题 ${i + 1}`,
          url: `https://www.example${i + 1}.com/a`,
          snippet: "短摘要",
          summary: "长摘要内容",
          datePublished: "2026-11-18T08:00:00Z",
        })),
      },
    },
  });

function makeDeps(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  extra: Partial<WebDeps> = {},
) {
  const run = vi.fn((_exe: string, _args: string[]) => "sk-key-a\nsk-key-b\n");
  const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) =>
    fetchImpl(String(url), init),
  );
  let settingsText: string | undefined;
  const deps: WebDeps = {
    env: {
      PRIMUS_EXE: "/opt/Primus/Primus.exe",
      PRIMUS_SEARCH_BASE_URL: "https://search.example.test/v1/",
      PRIMUS_WEB_SETTINGS: "/data/users/S-1/app/web.json",
    },
    fetch: fetchMock as unknown as typeof fetch,
    lookup: async () => ["93.184.216.34"],
    run,
    readSettings: () => settingsText,
    now: () => 1_000_000,
    ...extra,
  };
  const setSettings = (text: string | undefined) => {
    settingsText = text;
  };
  return { deps, run, fetchMock, setSettings };
}

const authOf = (init?: RequestInit) =>
  (init?.headers as Record<string, string> | undefined)?.Authorization;

describe("web_search 参数与结果", () => {
  it("规范化参数：未知时间范围回到 noLimit，结果数夹到 1–20，域名只留主机名", () => {
    expect(
      normalizeSearch({
        query: "  rust   1.99 ",
        freshness: "lastCentury",
        count: 99,
        include_domains: ["https://Docs.rs/x", "bad domain", 3 as never],
      }),
    ).toEqual({
      query: "rust 1.99",
      freshness: "noLimit",
      count: 20,
      includeDomains: ["docs.rs"],
      excludeDomains: [],
    });
    expect(normalizeSearch({ query: "x", freshness: "2026-01-01..2026-02-01" }).freshness).toBe(
      "2026-01-01..2026-02-01",
    );
    expect(normalizeSearch({ query: "x", count: 0 }).count).toBe(1);
    expect(normalizeSearch({ query: "x" }).count).toBe(8);
  });

  it("解析结果：跳过非 http 链接，摘要优先用 summary", async () => {
    const body = (await searchOk(1).json()) as unknown;
    expect(parseResults(body)).toEqual([
      {
        title: "标题 1",
        url: "https://www.example1.com/a",
        site: "www.example1.com",
        date: "2026-11-18T08:00:00Z",
        summary: "长摘要内容",
      },
    ]);
    expect(
      parseResults({ data: { webPages: { value: [{ name: "x", url: "ftp://a" }] } } }),
    ).toEqual([]);
    expect(parseResults(null)).toEqual([]);
  });

  it("给模型的文本：编号、链接、摘要截断，没有结果时给出建议", () => {
    const long = "字".repeat(5000);
    const text = formatResults("q", [
      { title: "A", url: "https://a.com", site: "a.com", summary: long },
    ]);
    expect(text).toContain("[1] A");
    expect(text).toContain("链接：https://a.com");
    expect(text.length).toBeLessThan(1600);
    expect(formatResults("q", [])).toContain("没有找到结果");
    // 超过 500 字符的有效链接完整保留，不被截断
    const longUrl = `https://a.com/path?q=${"x".repeat(700)}`;
    const withLongUrl = formatResults("q", [
      { title: "长链接", url: longUrl, site: "a.com", summary: "ok" },
    ]);
    expect(withLongUrl).toContain(`链接：${longUrl}`);
    // 完整链接超出预算时跳过该条，不返回半截 URL，后续较短结果仍可列出
    const hugeUrl = `https://a.com/${"u".repeat(MAX_RESULT_CHARS)}`;
    const skippedUrl = formatResults("q", [
      { title: "超长链接", url: hugeUrl, site: "a.com", summary: "s" },
      { title: "正常结果", url: "https://b.com/ok", site: "b.com", summary: "短摘要" },
    ]);
    expect(skippedUrl.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(skippedUrl).not.toContain("https://a.com/uuu");
    expect(skippedUrl).toContain("链接：https://b.com/ok");
    expect(skippedUrl).toContain("因长度限制未列出");
    // 多条单字段合规、合计超过 MAX_RESULT_CHARS 的结果受总长度限制并给出省略提示
    const many = Array.from({ length: 20 }, (_, i) => ({
      title: `结果 ${i + 1}`,
      url: `https://site${i + 1}.example.com/article`,
      site: `site${i + 1}.example.com`,
      summary: "摘".repeat(1000),
    }));
    const bounded = formatResults("q", many);
    expect(bounded.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(bounded).toContain("因长度限制未列出");
  });
});

describe("密钥轮换", () => {
  it("轮流使用，冷却中的排到最后", () => {
    let t = 0;
    const pool = new KeyPool(["a", "b"], () => t);
    expect(pool.order().map((k) => k.key)).toEqual(["a", "b"]);
    expect(pool.order().map((k) => k.key)).toEqual(["b", "a"]);
    pool.fail(0, 429);
    expect(pool.order().map((k) => k.key)).toEqual(["b", "a"]);
    expect(pool.order().map((k) => k.key)).toEqual(["b", "a"]);
    t = 61_000;
    expect(pool.order().map((k) => k.key)).toEqual(["a", "b"]);
    pool.fail(1, 500);
    expect(pool.order().map((k) => k.key)).toEqual(["b", "a"]);
  });
});

describe("web_search 执行", () => {
  const ctxSignal = undefined;

  it("取两把密钥，调用 /web-search，details 只给来源不含摘要", async () => {
    const { deps, run, fetchMock } = makeDeps(async () => searchOk());
    const w = createWeb(deps);
    const r = await w.search({ query: "乾元", freshness: "oneWeek", count: 3 }, ctxSignal);
    expect(run).toHaveBeenCalledWith("/opt/Primus/Primus.exe", ["--secret", SEARCH_SECRET_ID]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://search.example.test/v1/web-search");
    expect(authOf(init)).toBe("Bearer sk-key-a");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "乾元",
      count: 3,
      freshness: "oneWeek",
      summary: true,
      contents: { text: { maxCharacters: MAX_SUMMARY_CHARS } },
    });
    expect(r.isError).toBeUndefined();
    expect(r.details.status).toBe("done");
    expect(r.details.results).toHaveLength(2);
    expect(r.details.results[0]).not.toHaveProperty("summary");
    expect(r.content[0]?.text).toContain("长摘要内容");
    // 第二次搜索轮到第二把密钥；密钥只取一次
    await w.search({ query: "again" }, ctxSignal);
    expect(authOf(fetchMock.mock.calls[1]?.[1])).toBe("Bearer sk-key-b");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("一把限流 / 鉴权失败 / 服务端错误时换另一把，用户无感", async () => {
    for (const status of [429, 401, 503]) {
      const { deps, fetchMock } = makeDeps(async (_u, init) =>
        authOf(init) === "Bearer sk-key-a" ? json(status, { msg: "x" }) : searchOk(),
      );
      const r = await createWeb(deps).search({ query: "q" }, undefined);
      expect(r.details.status, String(status)).toBe("done");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it("业务码不是 200 时同样按状态处理", async () => {
    const { deps, fetchMock } = makeDeps(async (_u, init) =>
      authOf(init) === "Bearer sk-key-a" ? json(200, { code: 429, msg: "quota" }) : searchOk(),
    );
    const r = await createWeb(deps).search({ query: "q" }, undefined);
    expect(r.details.status).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("网络错误换密钥；两把都失败时报告原因", async () => {
    const { deps, fetchMock } = makeDeps(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await createWeb(deps).search({ query: "q" }, undefined);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.isError).toBe(true);
    expect(r.details).toMatchObject({ status: "failed", error: "无法连接搜索服务" });
  });

  it("请求被拒（400）不换密钥，把原因交给模型", async () => {
    const { deps, fetchMock } = makeDeps(async () => json(400, { msg: "count too large" }));
    const r = await createWeb(deps).search({ query: "q" }, undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.details.error).toContain("count too large");
  });

  it("用户停止：状态 cancelled，不再换密钥", async () => {
    const ctl = new AbortController();
    const { deps, fetchMock } = makeDeps(
      (_u, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          ctl.abort();
        }),
    );
    const r = await createWeb(deps).search({ query: "q" }, ctl.signal);
    expect(r.details.status).toBe("cancelled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("缺少关键词、关闭联网、取不到密钥时直接失败，不发请求", async () => {
    const a = makeDeps(async () => searchOk());
    expect((await createWeb(a.deps).search({ query: " " }, undefined)).details.error).toContain(
      "缺少",
    );
    a.setSettings('{"enabled":false}');
    expect((await createWeb(a.deps).search({ query: "q" }, undefined)).details.error).toContain(
      "关闭联网",
    );
    const b = makeDeps(async () => searchOk());
    b.run.mockImplementation(() => {
      throw new Error("denied");
    });
    expect((await createWeb(b.deps).search({ query: "q" }, undefined)).details.error).toBe(
      "搜索服务暂不可用",
    );
    expect(a.fetchMock).not.toHaveBeenCalled();
    expect(b.fetchMock).not.toHaveBeenCalled();
  });
});

describe("联网开关", () => {
  it("没有设置文件或内容无效时默认打开，每轮重新读取", () => {
    const { deps, setSettings } = makeDeps(async () => searchOk());
    const w = createWeb(deps);
    expect(w.enabled()).toBe(true);
    setSettings("not json");
    expect(w.enabled()).toBe(true);
    setSettings('{"enabled":false}');
    expect(w.enabled()).toBe(false);
    setSettings('{"enabled":true}');
    expect(w.enabled()).toBe(true);
    expect(createWeb({ ...deps, env: {} }).enabled()).toBe(true);
  });

  it("关闭时移除两个工具（含本轮的 selectedTools），打开时确保两个都在，其他工具不动", () => {
    let active = ["read", WEBSEARCH_TOOL, WEBFETCH_TOOL];
    const api = {
      getActiveTools: () => active,
      setActiveTools: vi.fn((n: string[]) => {
        active = n;
      }),
    };
    const reg = [WEBSEARCH_TOOL, WEBFETCH_TOOL];
    const opts: PromptOptions = { selectedTools: [...active] };
    syncActiveTools(api, opts, reg, false);
    expect(active).toEqual(["read"]);
    expect(opts.selectedTools).toEqual(["read"]);
    const next: PromptOptions = { selectedTools: ["read"] };
    syncActiveTools(api, next, reg, true);
    expect(active).toEqual(["read", WEBSEARCH_TOOL, WEBFETCH_TOOL]);
    expect(next.selectedTools).toEqual(["read", WEBSEARCH_TOOL, WEBFETCH_TOOL]);
    // Core 重启后从会话恢复的清单只有部分工具：打开时补齐
    active = ["read", WEBFETCH_TOOL];
    syncActiveTools(api, undefined, reg, true);
    expect(active).toEqual(["read", WEBFETCH_TOOL, WEBSEARCH_TOOL]);
    // 已经齐了就不调用 setActiveTools
    api.setActiveTools.mockClear();
    syncActiveTools(api, undefined, reg, true);
    expect(api.setActiveTools).not.toHaveBeenCalled();
  });

  it("离线模式一律不联网；设置文件读取出错时沿用上次的值，从未读到过则不联网", () => {
    const { deps } = makeDeps(async () => searchOk());
    expect(createWeb({ ...deps, env: { ...deps.env, PRIMUS_OFFLINE: "1" } }).enabled()).toBe(false);
    let fail = false;
    let text: string | undefined = '{"enabled":false}';
    const w = createWeb({
      ...deps,
      readSettings: () => {
        if (fail) throw new Error("EBUSY");
        return text;
      },
    });
    expect(w.enabled()).toBe(false);
    fail = true;
    expect(w.enabled()).toBe(false);
    fail = false;
    text = undefined;
    expect(w.enabled()).toBe(true);
    const never = createWeb({
      ...deps,
      readSettings: () => {
        throw new Error("EACCES");
      },
    });
    expect(never.enabled()).toBe(false);
  });

  it("注册：有搜索地址时注册两个工具，并在每轮开始前加“联网”小节与当前日期", () => {
    const tools: string[] = [];
    let handler: ((e: { systemPromptOptions?: PromptOptions }) => unknown) | undefined;
    let active: string[] = [];
    const { deps, setSettings } = makeDeps(async () => searchOk());
    web(
      {
        registerTool: (t: { name: string; annotations?: unknown }) => {
          tools.push(t.name);
          expect(t.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
          active.push(t.name);
        },
        on: (_e: string, h: typeof handler) => {
          handler = h;
        },
        getActiveTools: () => active,
        setActiveTools: (n: string[]) => {
          active = n;
        },
      },
      deps,
    );
    expect(tools).toEqual([WEBSEARCH_TOOL, WEBFETCH_TOOL]);
    const opts: PromptOptions = { selectedTools: [...active], sections: {} };
    handler?.({ systemPromptOptions: opts });
    expect(opts.sections?.[PROMPT_SECTION]).toContain(`当前日期：${localDate(1_000_000)}`);
    setSettings('{"enabled":false}');
    const off: PromptOptions = { selectedTools: [...active], sections: { web: "旧" } };
    handler?.({ systemPromptOptions: off });
    expect(off.sections).toEqual({});
    expect(active).toEqual([]);
  });

  it("没有搜索地址时只注册 web_fetch", () => {
    const tools: string[] = [];
    const { deps } = makeDeps(async () => searchOk());
    web({ registerTool: (t: { name: string }) => tools.push(t.name) }, { ...deps, env: {} });
    expect(tools).toEqual([WEBFETCH_TOOL]);
  });
});

describe("网址检查", () => {
  const lookup = async () => ["93.184.216.34"];

  it("内网与本机地址", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.1",
      "172.20.0.1",
      "169.254.1.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "0.0.0.0",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "2606:4700::1111", "172.32.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("只接受公网 http / https，拒绝凭证、本机名与解析到内网的域名", async () => {
    await expect(checkPublicUrl("https://example.com/a#x", lookup)).resolves.toMatchObject({
      href: "https://example.com/a",
    });
    for (const bad of [
      "file:///etc/passwd",
      "ftp://a.com",
      "http://user:pw@a.com",
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://[::1]/",
      "http://printer.local/",
      "not a url",
    ])
      await expect(checkPublicUrl(bad, lookup), bad).rejects.toBeInstanceOf(WebError);
    await expect(checkPublicUrl("https://evil.test", async () => ["10.0.0.5"])).rejects.toThrow(
      "内网",
    );
    // 解析不到地址：无法确认不在内网，拒绝
    await expect(
      checkPublicUrl("https://proxy-only.test", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow("无法解析");
  });

  it("域名解析受取消控制：中止后不再等待", async () => {
    const ctl = new AbortController();
    const pending = checkPublicUrl(
      "https://slow.test",
      () => new Promise<string[]>(() => {}),
      ctl.signal,
    );
    ctl.abort(new Error("stop"));
    await expect(pending).rejects.toThrow("stop");
  });
});

describe("HTML 转文本", () => {
  it("实体、标题", () => {
    expect(decodeEntities("a&amp;b &lt;i&gt; &#20013;&#x6587; &nbsp;&bogus;")).toBe(
      "a&b <i> 中文  &bogus;",
    );
    expect(htmlTitle("<head><title> 乾元 &amp; Primus </title></head>")).toBe("乾元 & Primus");
  });

  it("去掉脚本与导航，保留标题、列表、链接、代码块", () => {
    const html = `<html><head><title>T</title><style>.a{}</style></head><body>
      <nav><a href="/home">首页</a></nav>
      <h1>标题</h1>
      <p>第一段 <a href="/docs?a=1&amp;b=2">文档</a> 和 <a href="javascript:void(0)">按钮</a>。</p>
      <ul><li>一</li><li>二</li></ul>
      <pre><code class="language-rust">fn main() {
    println!("&lt;hi&gt;");
}</code></pre>
      <script>alert(1)</script>
      <textarea style="display:none">&lt;style&gt;.css{color:red}&lt;/style&gt;</textarea>
      <footer>版权</footer>
    </body></html>`;
    const md = htmlToMarkdown(html, "https://example.com/guide/");
    expect(md).toContain("# 标题");
    expect(md).toContain("[文档](https://example.com/docs?a=1&b=2)");
    expect(md).toContain("按钮");
    expect(md).not.toContain("javascript:");
    expect(md).toContain("- 一\n");
    expect(md).toContain('```rust\nfn main() {\n    println!("<hi>");\n}\n```');
    expect(md).not.toContain("alert");
    expect(md).not.toContain(".css");
    expect(md).not.toContain("首页");
    expect(md).not.toContain("版权");
  });
});

describe("web_fetch", () => {
  const page = (body: string, type = "text/html; charset=utf-8", status = 200) =>
    new Response(body, { status, headers: { "Content-Type": type } });
  const fetchDeps = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({
    fetch: vi.fn((u: string | URL | Request, i?: RequestInit) =>
      impl(String(u), i),
    ) as unknown as typeof fetch,
    lookup: async () => ["93.184.216.34"],
  });

  it("参数规范化", () => {
    expect(normalizeFetch({ url: " https://a.com ", offset: -5, max_chars: 999_999 })).toEqual({
      url: "https://a.com",
      find: "",
      offset: 0,
      maxChars: 40_000,
      version: "",
    });
  });

  it("读取 HTML：返回标题、地址与分段正文，提示下一段的 offset", async () => {
    const body = `<html><head><title>文档</title></head><body><main><p>${"内容".repeat(3000)}</p></main></body></html>`;
    const deps = fetchDeps(async () => page(body));
    const r = await runFetch(
      deps,
      normalizeFetch({ url: "https://a.com/x", max_chars: 1000 }),
      undefined,
    );
    expect(r.isError).toBeUndefined();
    expect(r.details).toMatchObject({
      status: "done",
      title: "文档",
      finalUrl: "https://a.com/x",
      contentType: "text/html",
      totalChars: 6000,
      range: [0, 1000],
    });
    expect(r.text).toContain("offset=1000");
  });

  it("跟随跳转并检查每一跳；跳到内网时拒绝", async () => {
    const deps = fetchDeps(async (url) =>
      url === "https://a.com/old"
        ? new Response(null, { status: 301, headers: { Location: "/new" } })
        : url === "https://a.com/new"
          ? page("<p>新页面</p>")
          : new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/admin" } }),
    );
    const ok = await runFetch(deps, normalizeFetch({ url: "https://a.com/old" }), undefined);
    expect(ok.details.finalUrl).toBe("https://a.com/new");
    expect(ok.text).toContain("新页面");
    const bad = await runFetch(deps, normalizeFetch({ url: "https://a.com/evil" }), undefined);
    expect(bad.isError).toBe(true);
    expect(bad.details.error).toContain("内网");
  });

  it("页内查找只返回命中片段", async () => {
    const text = `${"a".repeat(1000)} needle ${"b".repeat(1000)} NEEDLE`;
    const deps = fetchDeps(async () => page(text, "text/plain"));
    const r = await runFetch(
      deps,
      normalizeFetch({ url: "https://a.com/t", find: "Needle" }),
      undefined,
    );
    expect(r.details.matches).toBe(2);
    expect(r.text).toContain("共 2 处");
    expect(r.text.length).toBeLessThan(1600);
    expect(findInText("xx", "y").count).toBe(0);
  });

  it("按 meta 声明的编码解码（GBK）", async () => {
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]); // “中文”
    const head = new TextEncoder().encode('<html><head><meta charset="gbk"></head><body><p>');
    const tail = new TextEncoder().encode("</p></body></html>");
    const bytes = new Uint8Array([...head, ...gbk, ...tail]);
    const deps = fetchDeps(
      async () => new Response(bytes, { headers: { "Content-Type": "text/html" } }),
    );
    const r = await runFetch(deps, normalizeFetch({ url: "https://a.com/gbk" }), undefined);
    expect(r.text).toContain("中文");
  });

  it("不支持的内容类型、HTTP 错误、缺少网址", async () => {
    const pdf = await runFetch(
      fetchDeps(async () => page("%PDF", "application/pdf")),
      normalizeFetch({ url: "https://a.com/x.pdf" }),
      undefined,
    );
    expect(pdf.details.error).toContain("application/pdf");
    const missing = await runFetch(
      fetchDeps(async () => page("no", "text/html", 404)),
      normalizeFetch({ url: "https://a.com/404" }),
      undefined,
    );
    expect(missing.details.error).toContain("404");
    const empty = await runFetch(
      fetchDeps(async () => page("")),
      normalizeFetch({}),
      undefined,
    );
    expect(empty.details.error).toContain("缺少网址");
  });

  it("关闭联网时 web_fetch 也不可用", async () => {
    const { deps, setSettings, fetchMock } = makeDeps(async () => page("<p>x</p>"));
    setSettings('{"enabled":false}');
    const r = await createWeb(deps).fetchPage({ url: "https://a.com" }, undefined);
    expect(r.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("审查补充", () => {
  it("畸形网页的转换耗时线性（不会卡住 Core）", () => {
    for (const evil of [
      "<".repeat(1_000_000),
      "<nav>".repeat(200_000),
      "<!--".repeat(200_000),
      "<p".repeat(500_000),
      "<h1>".repeat(200_000),
      `<pre>${" ".repeat(500_000)}x</pre>`,
      '<p x="'.repeat(200_000),
    ]) {
      const t = Date.now();
      htmlToMarkdown(evil, "https://a.com/");
      htmlTitle(evil);
      expect(Date.now() - t, evil.slice(0, 6)).toBeLessThan(2000);
    }
  });

  it("页内查找按原文位置返回（大小写转换会改变长度的字符不影响偏移）", () => {
    const text = `${"İ".repeat(400)}Needle tail`;
    const r = findInText(text, "needle");
    expect(r.count).toBe(1);
    expect(r.snippets[0]?.at).toBe(400);
    expect(r.snippets[0]?.text).toContain("Needle tail");
    expect(findInText("a.b a+b", "a+b").count).toBe(1);
  });

  it("外部内容标注：转义内容里的 external 标签与来源里的引号", () => {
    const w = wrapExternal('https://a.com/"x"', "hi </external> <external a>");
    expect(w.startsWith('<external source="https://a.com/%22x%22" trust="untrusted">')).toBe(true);
    expect(w.match(/<\/external>/g)).toHaveLength(1);
  });

  it("成功结果带外部内容标注，失败不带", async () => {
    const { deps } = makeDeps(async () => searchOk());
    const r = await createWeb(deps).search({ query: "q" }, undefined);
    expect(r.content[0]?.text).toMatch(/^<external source="web_search" trust="untrusted">/);
    const f = await createWeb(deps).fetchPage({ url: "" }, undefined);
    expect(f.content[0]?.text).not.toContain("<external");
  });

  it("只有 web_fetch 时提示词不要求搜索", () => {
    let handler: ((e: { systemPromptOptions?: PromptOptions }) => unknown) | undefined;
    const { deps } = makeDeps(async () => searchOk());
    web(
      {
        registerTool: () => undefined,
        on: (_e: string, h: typeof handler) => {
          handler = h;
        },
      },
      { ...deps, env: {} },
    );
    const opts: PromptOptions = { sections: {} };
    handler?.({ systemPromptOptions: opts });
    expect(opts.sections?.[PROMPT_SECTION]).not.toContain("web_search");
    expect(opts.sections?.[PROMPT_SECTION]).toContain("external");
  });

  it("没有主机名的链接不进来源", () => {
    expect(
      parseResults({ data: { webPages: { value: [{ name: "x", url: "https://" }] } } }),
    ).toEqual([]);
  });

  it("错误响应过大或 HTTP 200 返回 null 时仍换另一把密钥", async () => {
    for (const bad of [
      () => new Response("x".repeat(5 * 1024 * 1024), { status: 503 }),
      () => json(200, null),
    ]) {
      const { deps, fetchMock } = makeDeps(async (_u, init) =>
        authOf(init) === "Bearer sk-key-a" ? bad() : searchOk(),
      );
      const r = await createWeb(deps).search({ query: "q" }, undefined);
      expect(r.details.status).toBe("done");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it("较早请求的成功不清除较新的冷却", () => {
    let t = 0;
    const pool = new KeyPool(["a", "b"], () => t);
    const stamp = pool.stamp(0);
    pool.fail(0, 429);
    pool.ok(0, stamp);
    t = 1;
    expect(pool.order()[0]?.key).toBe("b");
  });

  it("直连在建立连接时检查解析出的地址；放行时能解压", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain", "Content-Encoding": "gzip" });
      res.end(gzipSync("你好"));
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try {
      await expect(createDirectFetch(undefined, {})(`http://localhost:${port}/`)).rejects.toThrow(
        "内网",
      );
      const res = await createDirectFetch(() => false, {})(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("你好");
    } finally {
      server.close();
    }
  });

  it("searchFetch：发送字符串请求体（带 Content-Length），不拦截内网地址", async () => {
    let got: { method?: string; length?: string; body: string } = { body: "" };
    const server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (c: string) => {
        body += c;
      });
      req.on("end", () => {
        got = { method: req.method, length: req.headers["content-length"], body };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"code":200,"data":{}}');
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try {
      const payload = JSON.stringify({ query: "中文" });
      const res = await searchFetch({})(`http://localhost:${port}/web-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ code: 200, data: {} });
      expect(got.method).toBe("POST");
      expect(got.body).toBe(payload);
      expect(got.length).toBe(String(Buffer.byteLength(payload)));
      await expect(
        searchFetch({})(`http://localhost:${port}/`, {
          method: "POST",
          body: new Uint8Array([1]),
        }),
      ).rejects.toThrow("字符串请求体");
    } finally {
      server.close();
    }
  });

  it("代理连不上（代理软件已退出）时改为直连；代理拒绝时照常报错", async () => {
    const server = createServer((_req, res) => res.end("direct"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    // 占一个端口再关掉，得到一个没有进程监听的代理地址
    const dead = createNetServer();
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
    const deadPort = (dead.address() as { port: number }).port;
    await new Promise<void>((r) => dead.close(() => r()));
    // 回答 407 的代理：代理还在，只是拒绝
    const refusing = createServer();
    refusing.on("connect", (_req, socket) => {
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
    });
    await new Promise<void>((r) => refusing.listen(0, "127.0.0.1", r));
    const refusingPort = (refusing.address() as { port: number }).port;
    try {
      for (const f of [
        createDirectFetch(() => false, { HTTP_PROXY: `http://127.0.0.1:${deadPort}` }),
        searchFetch({ HTTP_PROXY: `http://127.0.0.1:${deadPort}` }),
      ]) {
        const res = await f(`http://127.0.0.1:${port}/`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("direct");
      }
      await expect(
        createDirectFetch(() => false, { HTTP_PROXY: `http://127.0.0.1:${refusingPort}` })(
          `http://127.0.0.1:${port}/`,
        ),
      ).rejects.toThrow("407");
    } finally {
      server.close();
      refusing.close();
    }
  });

  it("代理：按 HTTP(S)_PROXY / NO_PROXY 选择，只支持 http:// 代理", async () => {
    const env = { HTTP_PROXY: "http://p:8080", NO_PROXY: "localhost,.corp.example,10.0.0.1:443" };
    expect(proxyFor(new URL("https://a.com/"), env)?.host).toBe("p:8080");
    expect(proxyFor(new URL("http://a.com/"), { HTTPS_PROXY: "http://p:1" })).toBeUndefined();
    expect(proxyFor(new URL("https://x.corp.example/"), env)).toBeUndefined();
    expect(proxyFor(new URL("https://10.0.0.1/"), env)).toBeUndefined();
    expect(proxyFor(new URL("http://10.0.0.1/"), env)).toBeDefined();
    expect(() => proxyFor(new URL("https://a.com/"), { HTTPS_PROXY: "socks5://p:1" })).toThrow(
      "http://",
    );
    expect(() =>
      proxyFor(new URL("https://a.com/"), { HTTP_PROXY: "http://user:%ZZ@p:8080" }),
    ).toThrow("代理设置无效");
    await expect(
      createDirectFetch(() => false, { HTTP_PROXY: "http://user:%ZZ@127.0.0.1:8080" })(
        "https://a.com/",
      ),
    ).rejects.toThrow("代理设置无效");
  });

  it("走代理时用 CONNECT 连到本地检查过的 IP，代理不再解析域名", async () => {
    const hosts: string[] = [];
    const target = createServer((req, res) => {
      hosts.push(String(req.headers.host));
      res.end("ok");
    });
    await new Promise<void>((r) => target.listen(0, r));
    const tport = (target.address() as { port: number }).port;
    const seen: string[] = [];
    const proxy = createServer();
    proxy.on("connect", (req, client) => {
      seen.push(String(req.url));
      const url = String(req.url);
      const cut = url.lastIndexOf(":");
      const host = url.slice(0, cut).replace(/^\[|\]$/g, "");
      const up = netConnect(Number(url.slice(cut + 1)), host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        up.pipe(client);
        client.pipe(up);
      });
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const pport = (proxy.address() as { port: number }).port;
    try {
      const env = { HTTP_PROXY: `http://127.0.0.1:${pport}` };
      const res = await createDirectFetch(() => false, env)(`http://localhost:${tport}/`);
      expect(await res.text()).toBe("ok");
      expect(seen[0]).toMatch(/^(127\.0\.0\.1|\[::1\]):\d+$/);
      // 显式端口保留在 Host 里
      expect(hosts[0]).toBe(`localhost:${tport}`);
      await expect(createDirectFetch(undefined, env)(`http://localhost:${tport}/`)).rejects.toThrow(
        "内网",
      );
    } finally {
      proxy.close();
      target.close();
    }
  });

  it("走代理时 Host 按协议的默认端口省略，显式端口保留", () => {
    const hostOf = (raw: string): unknown => {
      const url = new URL(raw);
      const mod = url.protocol === "https:" ? httpsRequest : httpRequest;
      // 不真正连接：createConnection 不回调，只看 Node 生成的 Host
      const req = mod(
        url,
        proxiedOptions(url, { method: "GET" }, () => undefined),
      );
      req.on("error", () => undefined);
      const host = req.getHeader("host");
      req.destroy();
      return host;
    };
    expect(hostOf("https://example.com/")).toBe("example.com");
    expect(hostOf("https://example.com:8443/")).toBe("example.com:8443");
    expect(hostOf("http://example.com/")).toBe("example.com");
    expect(hostOf("http://example.com:8080/")).toBe("example.com:8080");
  });

  it("走代理时解析卡住也能立即中止，迟到的解析不再发 CONNECT", async () => {
    let pending: (() => void) | undefined;
    const hung = ((_host: string, _opts: unknown, cb: (e: null, a: string, f: number) => void) => {
      pending = () => cb(null, "93.184.216.34", 4);
    }) as unknown as Lookup;
    let connects = 0;
    const proxy = createServer();
    proxy.on("connect", (_req, client) => {
      connects++;
      client.destroy();
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const pport = (proxy.address() as { port: number }).port;
    try {
      const env = { HTTP_PROXY: `http://127.0.0.1:${pport}` };
      const ac = new AbortController();
      const started = Date.now();
      const p = createDirectFetch(
        () => false,
        env,
        hung,
      )("https://example.com/", {
        signal: ac.signal,
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(pending).toBeDefined();
      ac.abort();
      await expect(p).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(2000);
      pending?.();
      await new Promise((r) => setTimeout(r, 100));
      expect(connects).toBe(0);
    } finally {
      proxy.close();
    }
  });

  it("站点本地 IPv6、data-href、占位符伪造、代码块空行", () => {
    expect(isPrivateAddress("fec0::1")).toBe(true);
    expect(isPrivateAddress("feff::1")).toBe(true);
    expect(isPrivateAddress("ff00::1")).toBe(true);
    expect(isPrivateAddress("2001:4860::1")).toBe(false);
    expect(htmlToMarkdown('<a data-href="/t" href="/docs">文档</a>', "https://a.com/")).toBe(
      "[文档](https://a.com/docs)",
    );
    const forged = `<pre>${"x".repeat(1000)}</pre><p>${"\uE0000\uE000".repeat(50)}&#xE000;0&#xE000;</p>`;
    const out = htmlToMarkdown(forged);
    expect(out.length).toBeLessThan(1200);
    expect(out.match(/x{1000}/g)).toHaveLength(1);
    expect(htmlToMarkdown("<p>前</p><pre>a\n\n\n\nb</pre><p>后</p>")).toBe(
      "前\n\n```\na\n\n\n\nb\n```\n\n后",
    );
  });

  it("HTTP 101 协议升级时立即以错误结束，不会一直等待", async () => {
    const server = createNetServer((sock) => {
      sock.once("data", () =>
        sock.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
        ),
      );
      sock.on("error", () => undefined);
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try {
      const started = Date.now();
      await expect(createDirectFetch(() => false, {})(`http://localhost:${port}/`)).rejects.toThrow(
        "协议升级",
      );
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      server.close();
    }
  });

  it("HTTP 205 按无正文处理，普通 200 照常读正文", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/reset") {
        res.writeHead(205);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("正文");
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    try {
      const f = createDirectFetch(() => false, {});
      const reset = await f(`http://localhost:${port}/reset`);
      expect(reset.status).toBe(205);
      expect(reset.body).toBeNull();
      const ok = await f(`http://localhost:${port}/`);
      expect(await ok.text()).toBe("正文");
    } finally {
      server.close();
    }
  });

  it("后到的 429 不缩短已有的鉴权冷却，但仍更新冷却版本", () => {
    let t = 0;
    const pool = new KeyPool(["a", "b"], () => t);
    pool.fail(0, 401);
    const stamp = pool.stamp(0);
    pool.fail(0, 429);
    expect(pool.stamp(0)).toBe(stamp + 1);
    // 60 秒后 429 的冷却已过，但 401 的 10 分钟冷却仍在
    t = 2 * 60_000;
    pool.order();
    expect(pool.order()[0]?.key).toBe("b");
    expect(pool.order()[0]?.key).toBe("b");
    t = 11 * 60_000;
    const keys = [pool.order()[0]?.key, pool.order()[0]?.key];
    expect(keys).toContain("a");
  });

  it("HTTP 200 缺少 code 或 data 时换另一把密钥；合法的空结果照常接受", async () => {
    for (const bad of [{}, { data: { webPages: { value: [] } } }, { code: 200 }]) {
      const { deps, fetchMock } = makeDeps(async (_u, init) =>
        authOf(init) === "Bearer sk-key-a" ? json(200, bad) : searchOk(),
      );
      const r = await createWeb(deps).search({ query: "q" }, undefined);
      expect(r.details.status, JSON.stringify(bad)).toBe("done");
      expect(r.details.results).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
    const { deps, fetchMock } = makeDeps(async () =>
      json(200, { code: 200, msg: null, data: { webPages: { value: [] } } }),
    );
    const r = await createWeb(deps).search({ query: "q" }, undefined);
    expect(r.details.status).toBe("done");
    expect(r.details.results).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("可换密钥的状态不读正文：正文迟迟不结束也立即换下一把", async () => {
    const hanging = (status: number) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"msg":"slow'));
          },
        }),
        { status },
      );
    for (const status of [429, 401, 503]) {
      const { deps, fetchMock } = makeDeps(async (_u, init) =>
        authOf(init) === "Bearer sk-key-a" ? hanging(status) : searchOk(),
      );
      const started = Date.now();
      const r = await createWeb(deps).search({ query: "q" }, undefined);
      expect(r.details.status, String(status)).toBe("done");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(Date.now() - started).toBeLessThan(1000);
    }
  });

  it("文档专用地址按准确的 CIDR 边界拒绝，相邻公网地址放行", () => {
    for (const ip of [
      "192.0.2.0",
      "192.0.2.255",
      "198.51.100.0",
      "198.51.100.255",
      "203.0.113.0",
      "203.0.113.255",
      "2001:db8::",
      "2001:db8::1",
      "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
      "::ffff:192.0.2.1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of [
      "192.0.1.255",
      "192.0.3.0",
      "198.51.99.255",
      "198.51.101.0",
      "203.0.112.255",
      "203.0.114.0",
      "2001:db9::1",
      "2001:db7:ffff::1",
      "2001::1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("链接里的实体只解码一次", () => {
    expect(
      htmlToMarkdown('<a href="/docs?topic=AT&amp;copy;">文档 &amp;copy;</a>', "https://a.com/"),
    ).toBe("[文档 &copy;](https://a.com/docs?topic=AT&copy;)");
    expect(htmlToMarkdown('<a href="/s?a=1&amp;b=2">搜索</a>', "https://a.com/")).toBe(
      "[搜索](https://a.com/s?a=1&b=2)",
    );
  });

  it("代码块围栏长于内容里独占一行的反引号序列", () => {
    expect(htmlToMarkdown("<pre>a\n```\nb</pre>")).toBe("````\na\n```\nb\n````");
    expect(htmlToMarkdown("<pre>x\n  `````  \ny</pre>")).toBe("``````\nx\n  `````  \ny\n``````");
    // 行内的反引号不影响围栏长度
    expect(htmlToMarkdown("<pre>a ``` b</pre>")).toBe("```\na ``` b\n```");
  });

  it("属性值里的 > 不当作标签结束", () => {
    expect(htmlToMarkdown('<p><a title="x > y" href="/guide">指南</a></p>', "https://a.com/")).toBe(
      "[指南](https://a.com/guide)",
    );
    expect(
      htmlToMarkdown(
        '<p><a title=\'a>b\' href="/g"><span data-x="1>2">读</span>我</a></p>',
        "https://a.com/",
      ),
    ).toBe("[读我](https://a.com/g)");
    // 引号不闭合时退回第一个 >，不吞掉后面的内容
    expect(htmlToMarkdown('<p><span title="坏>正文</span></p>')).toBe("正文");
  });

  it("续读带正文版本：未变化时按 offset 续读，变化时从头返回并说明", async () => {
    let text = "甲".repeat(3000);
    const deps = {
      fetch: vi.fn(
        async () => new Response(text, { status: 200, headers: { "Content-Type": "text/plain" } }),
      ) as unknown as typeof fetch,
      lookup: async () => ["93.184.216.34"],
    };
    const first = await runFetch(
      deps,
      normalizeFetch({ url: "https://a.com/", max_chars: 1000 }),
      undefined,
    );
    const v = textVersion(text);
    expect(first.text).toContain(`offset=1000、version=${v}`);
    const same = await runFetch(
      deps,
      normalizeFetch({ url: "https://a.com/", offset: 1000, max_chars: 1000, version: v }),
      undefined,
    );
    expect(same.details.range).toEqual([1000, 2000]);
    expect(same.text).not.toContain("已变化");
    text = "乙".repeat(2800);
    const changed = await runFetch(
      deps,
      normalizeFetch({ url: "https://a.com/", offset: 1000, max_chars: 1000, version: v }),
      undefined,
    );
    expect(changed.details.range).toEqual([0, 1000]);
    expect(changed.text).toContain("已变化");
    expect(changed.text).toContain(`version=${textVersion(text)}`);
    // 不带 version 时照旧按 offset
    const legacy = await runFetch(
      deps,
      normalizeFetch({ url: "https://a.com/", offset: 1000, max_chars: 1000 }),
      undefined,
    );
    expect(legacy.details.range).toEqual([1000, 2000]);
  });

  it("超长的查找关键词明确拒绝，不静默截短", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(`${"a".repeat(200)}c`, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    );
    const deps = {
      fetch: fetchMock as unknown as typeof fetch,
      lookup: async () => ["93.184.216.34"],
    };
    const long = `${"a".repeat(MAX_FIND_CHARS)}b`;
    expect(normalizeFetch({ url: "https://a.com/", find: long }).find).toBe(long);
    const r = await runFetch(
      deps,
      normalizeFetch({ url: "https://a.com/", find: long }),
      undefined,
    );
    expect(r.isError).toBe(true);
    expect(r.text).toContain("过长");
    expect(fetchMock).not.toHaveBeenCalled();
    const ok = await runFetch(
      deps,
      normalizeFetch({ url: "https://a.com/", find: "a".repeat(MAX_FIND_CHARS) }),
      undefined,
    );
    expect(ok.details.matches).toBe(1);
  });
});

describe("审查补充（680f187）", () => {
  const textDeps = (body: BodyInit, type: string) => ({
    fetch: vi.fn(
      async () => new Response(body, { status: 200, headers: { "Content-Type": type } }),
    ) as unknown as typeof fetch,
    lookup: async () => ["93.184.216.34"],
  });

  it("链接展开有总长度预算：预算内保留完整地址，超出后只留文字", () => {
    const base = `https://a.com/${"x".repeat(1900)}/`;
    const n = 1000;
    const html = Array.from({ length: n }, (_, i) => `<p><a href="p${i}">L${i}</a></p>`).join("");
    const md = htmlToMarkdown(html, base);
    expect(md).toContain(`[L0](${base}p0)`);
    expect(md).toContain(`\nL${n - 1}`);
    expect(md).not.toContain(`[L${n - 1}]`);
    expect(md.length).toBeLessThan(MAX_LINK_CHARS + html.length);
    // 单个地址过长：只留文字
    const long = `https://a.com/${"y".repeat(MAX_HREF_CHARS)}`;
    expect(htmlToMarkdown(`<a href="${long}">长</a>`)).toBe("长");
  });

  it("分页不切开 UTF-16 代理对", async () => {
    const text = `${"a".repeat(999)}😀${"b".repeat(1000)}`;
    const deps = textDeps(text, "text/plain");
    const first = await runFetch(
      deps,
      normalizeFetch({ url: "https://a.com/", max_chars: 1000 }),
      undefined,
    );
    expect(first.details.range).toEqual([0, 999]);
    expect(first.text).toContain("offset=999");
    const next = await runFetch(
      deps,
      normalizeFetch({ url: "https://a.com/", offset: 999, max_chars: 1000 }),
      undefined,
    );
    expect(next.details.range).toEqual([999, 1999]);
    expect(next.text).toContain("😀b");
  });

  it("标签名完整匹配：nav-panel 不是 nav，a-link 不是 a", () => {
    expect(htmlToMarkdown("<nav-panel><p>正文</p></nav-panel><nav>菜单</nav>")).toBe("正文");
    expect(htmlToMarkdown('<p><a-link>甲</a-link> <a href="/g">乙</a></p>', "https://a.com/")).toBe(
      "甲 [乙](https://a.com/g)",
    );
    expect(htmlToMarkdown("<ul><link-item>x</link-item><li>y</li></ul>")).toBe("x\n- y");
  });

  it("属性名匹配跳过其他属性的值", () => {
    expect(
      htmlToMarkdown('<p><a title="旧 href=/old" href="/guide">指南</a></p>', "https://a.com/"),
    ).toBe("[指南](https://a.com/guide)");
    expect(htmlToMarkdown("<p><a data-x='a href=/old' HREF=/u>读</a></p>", "https://a.com/")).toBe(
      "[读](https://a.com/u)",
    );
    expect(htmlToMarkdown('<p><img title="x alt=假" alt="真"></p>')).toBe("[图片：真]");
  });

  it("只从有效的 meta 编码声明读取字符集", async () => {
    const utf8 = new TextEncoder().encode(
      '<html><head><meta name="description" content="说明 charset=gbk"><meta data-charset="gbk"></head><body><p>中文正文</p></body></html>',
    );
    const r1 = await runFetch(
      textDeps(utf8, "text/html"),
      normalizeFetch({ url: "https://a.com/u" }),
      undefined,
    );
    expect(r1.text).toContain("中文正文");
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]); // “中文”
    const head = new TextEncoder().encode(
      '<html><head><!-- <meta charset="big5"> --><meta http-equiv="Content-Type" content="text/html; charset=gbk"></head><body><p>',
    );
    const tail = new TextEncoder().encode("</p></body></html>");
    const r2 = await runFetch(
      textDeps(new Uint8Array([...head, ...gbk, ...tail]), "text/html"),
      normalizeFetch({ url: "https://a.com/g" }),
      undefined,
    );
    expect(r2.text).toContain("中文");
  });

  it("freshness 校验真实日期与范围顺序，无效时回到 noLimit", () => {
    const f = (freshness: string) => normalizeSearch({ query: "x", freshness }).freshness;
    expect(f("2026-02-30")).toBe("noLimit");
    expect(f("2026-13-01")).toBe("noLimit");
    expect(f("2026-09-13..2026-09-01")).toBe("noLimit");
    expect(f("2026-02-01..2026-02-30")).toBe("noLimit");
    expect(f("2024-02-29")).toBe("2024-02-29");
    expect(f("2026-09-01..2026-09-01")).toBe("2026-09-01..2026-09-01");
    expect(f("oneWeek")).toBe("oneWeek");
  });
});
