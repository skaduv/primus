import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import { findViolations, run, stripComments } from "./check-tauri-imports.mjs";

const TAURI = ["@tauri-apps", "api/core"].join("/");
const dirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "tauri-imports-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

// Windows 未开启开发者模式、也没有创建符号链接的权限时 symlinkSync 会抛 EPERM：
// 返回 false 让用例跳过，而不是让整个 pnpm test 失败；其他错误照常抛出。
function trySymlink(target: string, path: string, type?: "dir" | "file"): boolean {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") return false;
    throw error;
  }
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("平台边界检查", () => {
  it("识别静态导入、副作用导入、再导出、动态导入、require 与全局对象", () => {
    const code = [
      `import { invoke } from "${TAURI}";`,
      `import "${TAURI}";`,
      `export { Channel } from "${TAURI}";`,
      `const m = await import("${TAURI}");`,
      `const r = require('${TAURI}');`,
      "const x = window.__TAURI_INTERNALS__;",
    ].join("\n");
    const found = findViolations(code);
    expect(found.map((v: { line: number }) => v.line)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("多行 import 也能识别", () => {
    const code = `import {\n  invoke,\n  Channel,\n} from "${TAURI}";`;
    expect(findViolations(code)).toHaveLength(1);
  });

  it("注释里的示例不算违规", () => {
    const code = `// import { invoke } from "${TAURI}";\n/* import("${TAURI}") */\nconst a = 1;`;
    expect(stripComments(code)).not.toContain("@tauri-apps");
    expect(findViolations(code)).toEqual([]);
  });

  it("多行块注释之后的违规行号与原文件一致", () => {
    const code = `/**\n * 文件头\n * 多行说明\n */\nconst a = 1;\nimport { invoke } from "${TAURI}";`;
    expect(findViolations(code).map((v: { line: number }) => v.line)).toEqual([6]);
  });

  it("跳过符号链接（含悬空链接），不越出根目录", (ctx) => {
    const imp = `import { invoke } from "${TAURI}";\n`;
    const outside = fixture({ "secret/bad.ts": imp });
    const root = fixture({ "packages/ui/src/ok.ts": "export const a = 1;\n" });
    const linked =
      trySymlink(join(outside, "secret"), join(root, "packages/ui/src/linked"), "dir") &&
      trySymlink(join(outside, "missing.ts"), join(root, "packages/ui/src/dangling.ts"));
    if (!linked) {
      ctx.skip("当前环境无权创建符号链接（Windows 未开启开发者模式），跳过");
      return;
    }
    const { findings, scanned } = run(root);
    expect(findings).toEqual([]);
    expect(scanned).toBe(1);
  });

  it("只放行 platform/tauri/ 目录，其余位置报错", () => {
    const imp = `import { invoke } from "${TAURI}";\n`;
    const root = fixture({
      "apps/desktop/src/lib/platform/tauri/index.ts": imp,
      "apps/desktop/src/lib/platform/index.ts": 'import("./tauri");\n',
      "apps/desktop/src/features/chat/bad.tsx": `\n${imp}`,
      "packages/ui/src/bad.ts": imp,
      "packages/ui/node_modules/x/index.js": imp,
    });
    const { findings, scanned } = run(root);
    expect(findings).toEqual([
      `apps/desktop/src/features/chat/bad.tsx:2 导入 ${TAURI}`,
      `packages/ui/src/bad.ts:1 导入 ${TAURI}`,
    ]);
    expect(scanned).toBe(4);
  });
});
