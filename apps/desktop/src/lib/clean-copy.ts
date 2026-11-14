// 选中复制（Ctrl+C / 右键复制）时写进剪贴板的内容。
//
// WebView2（Chromium）默认把选区连同“计算后的样式”一起复制成 HTML：字体、字号、颜色（深色模式下是浅色字）、
// 背景、圆角等都以内联 style 带进 Word、邮件、飞书等富文本编辑器；文件引用胶囊只复制出文件名，完整路径丢失；
// 列表的序号与圆点、图标都不在纯文本里。这里改为：
// - text/html：只保留语义结构（段落、标题、粗体、斜体、代码、列表、引用、表格、链接），去掉所有 class / style
//   与图标、按钮，文件引用换成 `<code>完整路径:行号</code>`，粘贴后跟随目标文档自己的格式；
// - text/plain：可读的纯文本，列表保留“- ”与“1. ”，表格单元格用制表符分隔，文件引用为完整路径。
// 不添加任何额外内容（来源、水印、链接等）。输入框、代码编辑器、终端里的复制保持系统默认行为。

/** 选区在这些元素里时不接管（它们有自己的复制逻辑或本来就是纯文本） */
const NATIVE_COPY =
  "input, textarea, [contenteditable=''], [contenteditable='true'], .cm-editor, .xterm";

/** 原样保留（去掉属性）的语义标签 */
const KEEP = new Set([
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "del",
  "s",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
]);
/** 不复制的元素：图标、脚本、样式、表单控件 */
const SKIP = new Set(["svg", "script", "style", "template", "img", "input", "textarea", "select"]);
/** 布局容器：保留为不带属性的块，复制多条消息时仍各自成段 */
const BLOCK_WRAPPERS = new Set(["div", "article", "section", "header", "footer", "main", "aside"]);
/** 纯文本中自成一段的元素 */
const BLOCK = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "table",
  "tr",
  "hr",
  ...BLOCK_WRAPPERS,
]);
const SAFE_HREF = /^(https?:|mailto:)/i;

/** 把选区克隆出的片段转换成干净的 HTML 片段（新文档中的节点） */
export function cleanFragment(src: DocumentFragment | Node, doc: Document): DocumentFragment {
  const out = doc.createDocumentFragment();
  for (const child of Array.from(src.childNodes)) appendClean(child, out, doc);
  return out;
}

function appendClean(node: Node, parent: Node, doc: Document): void {
  if (node.nodeType === 3) {
    parent.appendChild(doc.createTextNode(node.textContent ?? ""));
    return;
  }
  if (node.nodeType !== 1 && node.nodeType !== 11) return;
  if (node.nodeType === 11) {
    for (const c of Array.from(node.childNodes)) appendClean(c, parent, doc);
    return;
  }
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (
    SKIP.has(tag) ||
    el.getAttribute("aria-hidden") === "true" ||
    el.hasAttribute("data-copy-skip")
  )
    return;
  // 文件引用胶囊：完整路径加行号（与右键“复制路径”相同）
  const fileRef = el.getAttribute("data-file-ref");
  if (fileRef !== null) {
    const code = doc.createElement("code");
    code.textContent = fileRef;
    parent.appendChild(code);
    return;
  }
  // 其他按钮（复制、展开等操作）不进剪贴板
  if (tag === "button") return;
  let target: Node = parent;
  if (KEEP.has(tag)) {
    const copy = doc.createElement(tag);
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      if (SAFE_HREF.test(href.trim())) copy.setAttribute("href", href.trim());
    } else if (tag === "ol") {
      const start = el.getAttribute("start");
      if (start && /^\d+$/.test(start)) copy.setAttribute("start", start);
    } else if (tag === "td" || tag === "th") {
      for (const a of ["colspan", "rowspan"]) {
        const v = el.getAttribute(a);
        if (v && /^\d+$/.test(v)) copy.setAttribute(a, v);
      }
    }
    parent.appendChild(copy);
    target = copy;
  } else if (BLOCK_WRAPPERS.has(tag)) {
    const div = doc.createElement("div");
    parent.appendChild(div);
    target = div;
  }
  for (const c of Array.from(el.childNodes)) appendClean(c, target, doc);
}

/** 干净片段的纯文本：块元素分段，列表带符号，表格用制表符 */
export function fragmentText(root: Node): string {
  const lines: string[] = [];
  let line = "";
  const flush = () => {
    if (line.trim() !== "" || lines.length === 0 || lines.at(-1) !== "")
      lines.push(line.replace(/\s+$/, ""));
    line = "";
  };
  const breakBlock = () => {
    if (line.trim() !== "") flush();
    else line = "";
  };

  const walk = (node: Node, pre: boolean, indent: string) => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? "";
      if (pre) {
        const parts = text.split("\n");
        parts.forEach((p, i) => {
          if (i > 0) flush();
          line += p;
        });
      } else {
        const collapsed = text.replace(/[ \t\r\n]+/g, " ");
        line += line === "" || /\s$/.test(line) ? collapsed.replace(/^ /, "") : collapsed;
      }
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const tag = node.nodeType === 1 ? (node as Element).tagName.toLowerCase() : "";
    const kids = Array.from(node.childNodes);
    switch (tag) {
      case "br":
        flush();
        return;
      case "hr":
        breakBlock();
        lines.push("---");
        return;
      case "ul":
      case "ol": {
        breakBlock();
        let n = Number((node as Element).getAttribute("start") ?? "1") || 1;
        for (const li of kids) {
          if (li.nodeType !== 1 || (li as Element).tagName.toLowerCase() !== "li") {
            walk(li, pre, indent);
            continue;
          }
          breakBlock();
          line = `${indent}${tag === "ol" ? `${n++}. ` : "- "}`;
          for (const c of Array.from(li.childNodes)) walk(c, pre, `${indent}  `);
          breakBlock();
        }
        return;
      }
      case "tr": {
        breakBlock();
        const cells = kids
          .filter((c) => c.nodeType === 1)
          .map((c) => fragmentText(c).replace(/\n+/g, " ").trim());
        lines.push(cells.join("\t"));
        return;
      }
      case "pre":
        breakBlock();
        for (const c of kids) walk(c, true, indent);
        breakBlock();
        return;
    }
    const block = BLOCK.has(tag);
    if (block) breakBlock();
    for (const c of kids) walk(c, pre, indent);
    if (block) breakBlock();
  };
  walk(root, false, "");
  if (line.trim() !== "") flush();
  // 去掉首尾空行、合并连续空行
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** 选区应交给系统默认复制（输入框、编辑器、终端里，或没有选中内容）时返回 true */
export function isNativeCopy(selection: Selection | null): boolean {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return true;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !el || !!el.closest(NATIVE_COPY);
}

/** document 的 copy 事件处理：接管时写入干净的 HTML 与纯文本 */
export function handleCopy(e: ClipboardEvent): void {
  const doc = (e.target as Node | null)?.ownerDocument ?? document;
  const selection = doc.getSelection();
  if (isNativeCopy(selection) || !e.clipboardData || !selection) return;
  const holder = doc.createElement("div");
  for (let i = 0; i < selection.rangeCount; i++)
    holder.appendChild(cleanFragment(selection.getRangeAt(i).cloneContents(), doc));
  const text = fragmentText(holder);
  if (!text) return;
  e.clipboardData.setData("text/plain", text);
  e.clipboardData.setData("text/html", holder.innerHTML);
  e.preventDefault();
}
