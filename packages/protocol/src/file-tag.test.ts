import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  appendFileTags,
  FILE_INLINE_MAX_BYTES,
  formatFileTag,
  splitFileTags,
  stripImageHints,
} from "./index.ts";

const CORE = new URL("../../../agent-core/packages/coding-agent/src/", import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, CORE)), "utf8");

describe("附件标签（Core @file 格式）", () => {
  it("空标签与内联标签的写法与 Core 的 file-processor 一致", () => {
    const processor = read("cli/file-processor.ts");
    const tag = (body: string) => `\`<file name="$\{absolutePath}">${body}</file>\\n\``;
    expect(processor).toContain(tag(""));
    expect(processor).toContain(tag(["\\n$", "{content}\\n"].join("")));
    expect(formatFileTag({ path: "C:\\a\\x.xlsx" })).toBe('<file name="C:\\a\\x.xlsx"></file>');
    expect(formatFileTag({ path: "/a/b.md", content: "# 标题" })).toBe(
      '<file name="/a/b.md">\n# 标题\n</file>',
    );
  });

  it("内联上限与 Core read 工具一致", () => {
    expect(read("core/tools/truncate.ts")).toContain("export const DEFAULT_MAX_BYTES = 50 * 1024;");
    expect(FILE_INLINE_MAX_BYTES).toBe(50 * 1024);
  });

  it("标签附在正文之后，拆分后还原", () => {
    const files = [{ path: "C:\\图\\a.png" }, { path: "C:\\x.xlsx" }];
    const text = appendFileTags("帮我看看", files);
    expect(text).toBe(
      '帮我看看\n\n<file name="C:\\图\\a.png"></file>\n<file name="C:\\x.xlsx"></file>',
    );
    expect(splitFileTags(text)).toEqual({ message: "帮我看看", files });
  });

  it("没有正文时只有标签；没有附件时原样返回", () => {
    expect(appendFileTags("", [{ path: "/a" }])).toBe('<file name="/a"></file>');
    expect(appendFileTags("hi", [])).toBe("hi");
    expect(splitFileTags('<file name="/a"></file>')).toEqual({
      message: "",
      files: [{ path: "/a" }],
    });
  });

  it("解析扩展展开后的内联标签，内容可以含空行与 </file> 字样", () => {
    const content = '第一行\n\n<file name="假的"></file>\n</file> 不在行首也算内容';
    const text = appendFileTags("看这个", [{ path: "/a.md", content }, { path: "/b.pdf" }]);
    expect(splitFileTags(text)).toEqual({
      message: "看这个",
      files: [{ path: "/a.md", content }, { path: "/b.pdf" }],
    });
  });

  it("内联内容含独占一行的 </file> 时仍能解析", () => {
    const content = "first\n</file>\nsecond";
    const text = appendFileTags("看", [{ path: "/a.txt", content }, { path: "/b.pdf" }]);
    expect(splitFileTags(text)).toEqual({
      message: "看",
      files: [{ path: "/a.txt", content }, { path: "/b.pdf" }],
    });
    const only = appendFileTags("", [{ path: "/a.txt", content }]);
    expect(splitFileTags(only).files).toEqual([{ path: "/a.txt", content }]);
  });

  it("正文中间提到的标签不算附件", () => {
    const text = '格式是 <file name="x"></file> 这样\n\n后面还有话';
    expect(splitFileTags(text)).toEqual({ message: text, files: [] });
    const tail = '说明\n\n<file name="x"></file>\n然后继续说';
    expect(splitFileTags(tail).files).toEqual([]);
  });

  it("兼容 CRLF 与标签后的空行", () => {
    expect(splitFileTags('问\n\n<file name="/a"></file>\r\n<file name="/b"></file>\n')).toEqual({
      message: "问",
      files: [{ path: "/a" }, { path: "/b" }],
    });
  });

  it("Core 在消息末尾追加的图片说明行不影响附件解析", () => {
    // 说明行的写法与 Core 一致（agent-session.ts、image-resize.ts、image-process.ts）
    expect(read("core/agent-session.ts")).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 比对 Core 源码里的模板字符串原文
      '`${trigger.prompt}\\n\\n${normalized.hints.join("\\n")}`',
    );
    expect(read("utils/image-resize.ts")).toContain("`[Image: original ${");
    expect(read("utils/image-process.ts")).toContain("`[Image converted from ${");
    expect(read("utils/image-process.ts")).toContain('"[Image omitted: ');
    const hints = [
      "[Image: original 3000x2000, displayed at 1500x1000. Multiply coordinates by 2.00 to map to original image.]",
      "[Image converted from image/bmp to image/png.]",
    ].join("\n");
    const text = appendFileTags("看看这张图", [{ path: "C:\\a.png" }, { path: "C:\\b.md" }]);
    expect(splitFileTags(`${text}\n\n${hints}`)).toEqual({
      message: "看看这张图",
      files: [{ path: "C:\\a.png" }, { path: "C:\\b.md" }],
    });
    // 粘贴的图片没有标签：只去掉说明行；只有图片时正文为空
    expect(splitFileTags(`问\n\n${hints}`)).toEqual({ message: "问", files: [] });
    expect(stripImageHints(`\n\n${hints}`)).toBe("");
    // 用户自己写的方括号文字保留
    expect(stripImageHints("[Image] 这是标题")).toBe("[Image] 这是标题");
  });
});
