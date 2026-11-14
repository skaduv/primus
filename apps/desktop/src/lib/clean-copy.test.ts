import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/features/chat/message-content";
import { cleanFragment, fragmentText, handleCopy, isNativeCopy } from "./clean-copy";

function clean(html: string) {
  const src = document.createElement("div");
  src.innerHTML = html;
  const holder = document.createElement("div");
  holder.appendChild(cleanFragment(src, document));
  return { html: holder.innerHTML, text: fragmentText(holder) };
}

describe("clean-copy", () => {
  it("去掉 class、style 与图标，只留语义标签", () => {
    const { html, text } = clean(
      '<div class="md" style="color:#fff"><h2 style="font-size:20px">标题</h2><p>一段<strong class="x">粗体</strong>和<code>code</code><svg aria-hidden="true"><path d="M0"/></svg></p></div>',
    );
    expect(html).toBe(
      "<div><h2>标题</h2><p>一段<strong>粗体</strong>和<code>code</code></p></div>",
    );
    expect(text).toBe("标题\n一段粗体和code");
  });

  it("文件引用胶囊复制成完整路径加行号，其他按钮不复制", () => {
    const md = renderMarkdown("看 `src/lib/utils.ts:12` 这里");
    expect(md).toContain("data-file-ref");
    const { html, text } = clean(`${md}<button aria-label="复制">复制</button>`);
    expect(html).toContain("<code>src/lib/utils.ts:12</code>");
    expect(html).not.toContain("button");
    expect(text).toBe("看 src/lib/utils.ts:12 这里");
  });

  it("列表保留符号与序号，代码块保留换行，表格用制表符", () => {
    const md = renderMarkdown(
      "1. 第一\n2. 第二\n   - 子项\n\n```\nconst a = 1;\n  b();\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    );
    const { text } = clean(md);
    expect(text).toBe("1. 第一\n2. 第二\n  - 子项\nconst a = 1;\n  b();\nA\tB\n1\t2");
  });

  it("外链只保留 http(s) 地址，外链图标不复制", () => {
    const { html, text } = clean(renderMarkdown("[文档](https://example.com/a)"));
    expect(html.trim()).toBe('<p><a href="https://example.com/a">文档</a></p>');
    expect(text).toBe("文档");
  });

  it("copy 事件：写入干净的 HTML 与纯文本并阻止默认；输入框里的复制保持默认", () => {
    document.body.innerHTML = `<div class="md">${renderMarkdown("**你好** 世界")}</div><textarea>原文</textarea>`;
    const p = document.querySelector(".md p") as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = document.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(isNativeCopy(sel)).toBe(false);
    const data: Record<string, string> = {};
    let prevented = false;
    handleCopy({
      target: p,
      clipboardData: { setData: (k: string, v: string) => (data[k] = v) },
      preventDefault: () => (prevented = true),
    } as unknown as ClipboardEvent);
    expect(prevented).toBe(true);
    expect(data["text/plain"]).toBe("你好 世界");
    expect(data["text/html"]).toBe("<strong>你好</strong> 世界");

    const ta = document.querySelector("textarea") as HTMLTextAreaElement;
    const r2 = document.createRange();
    r2.selectNodeContents(ta);
    sel.removeAllRanges();
    sel.addRange(r2);
    expect(isNativeCopy(sel)).toBe(true);
  });
});
