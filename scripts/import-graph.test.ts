import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import { resolveExports, runtimeImports, walkImportGraph } from "./import-graph.mjs";

const dirs: string[] = [];

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "import-graph-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("runtimeImports", () => {
  it("识别各种运行时导入写法，跳过仅类型导入与整行注释", () => {
    const code = [
      'import a from "a";',
      'import "b";',
      'export { c } from "c";',
      'export * from "d";',
      'const e = require("e");',
      'await import("f");',
      'import type { T } from "t";',
      'export type { U } from "u";',
      'import type from "named-type";',
      "// import x from 'commented'",
      ' * import y from "jsdoc"',
    ].join("\n");
    expect(runtimeImports(code).sort()).toEqual(["a", "b", "c", "d", "e", "f", "named-type"]);
  });

  it("压缩产物：引号必须成对，不会跨字符串误配", () => {
    const code = `import{x}from"./chunk-A.js";var s='",t=require("y"),u="';import("./lazy.js")`;
    expect(runtimeImports(code).sort()).toEqual(["./chunk-A.js", "./lazy.js", "y"]);
  });
});

describe("resolveExports", () => {
  it("按条件与 * 子路径模式解析 exports", () => {
    const exp = {
      ".": { types: "./index.d.ts", import: "./esm/index.js", require: "./cjs/index.js" },
      "./feature/*": { node: "./dist/feature/*.js" },
      "./package.json": "./package.json",
    };
    expect(resolveExports(exp, ".")).toBe("./esm/index.js");
    expect(resolveExports(exp, "./feature/x")).toBe("./dist/feature/x.js");
    expect(resolveExports(exp, "./missing")).toBeNull();
    expect(resolveExports("./main.js", ".")).toBe("./main.js");
  });
});

describe("walkImportGraph", () => {
  it("沿相对路径、别名、包入口与包内部传递遍历，并给出导入链", () => {
    const root = tree({
      "src/app/page.tsx": 'import { util } from "@/lib/util";\nimport "./style.css";',
      "src/lib/util.ts": 'export { draw as util } from "chart-kit/draw";',
      "src/lib/unused.ts": 'import "never-imported";',
      "node_modules/chart-kit/package.json": JSON.stringify({
        name: "chart-kit",
        exports: { "./draw": { import: "./lib/draw.mjs" } },
      }),
      "node_modules/chart-kit/lib/draw.mjs":
        'import { c } from "deep-sdk/client";\nexport const draw = c;',
      "node_modules/deep-sdk/package.json": JSON.stringify({ name: "deep-sdk", main: "index.js" }),
      "node_modules/deep-sdk/client.js": "exports.c = 1;",
    });
    const r = walkImportGraph([join(root, "src/app/page.tsx")], {
      aliases: { "@/": join(root, "src/") },
    });
    expect([...r.packages.keys()].sort()).toEqual(["chart-kit", "deep-sdk"]);
    const chain = r.packages.get("deep-sdk");
    expect(chain.filter((_: string, i: number) => i % 2 === 1)).toEqual([
      "@/lib/util",
      "chart-kit/draw",
      "deep-sdk/client",
    ]);
    expect(r.missing.has("never-imported")).toBe(false);
  });

  it("TS 源码中写成 .js 的相对导入解析到 .ts；跟随工作区符号链接", () => {
    const root = tree({
      "packages/a/src/index.ts": 'import { b } from "./b.js";\nimport "@ws/lib";',
      "packages/a/src/b.ts": 'export const b = require("left-pad");',
      "packages/lib/package.json": JSON.stringify({ name: "@ws/lib", main: "./main.js" }),
      "packages/lib/main.js": 'import "lib-dep";',
    });
    mkdirSync(join(root, "packages/a/node_modules/@ws"), { recursive: true });
    symlinkSync(
      join(root, "packages/lib"),
      join(root, "packages/a/node_modules/@ws/lib"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const r = walkImportGraph([join(root, "packages/a/src/index.ts")]);
    expect([...r.packages.keys()]).toEqual(["@ws/lib"]);
    expect([...r.missing.keys()].sort()).toEqual(["left-pad", "lib-dep"]);
  });

  it("包内私有导入（#）按 package.json imports 解析", () => {
    const root = tree({
      "node_modules/kit/package.json": JSON.stringify({
        name: "kit",
        main: "index.js",
        imports: { "#impl": { node: "impl-sdk" } },
      }),
      "node_modules/kit/index.js": 'require("#impl");',
      "entry.js": 'require("kit");',
    });
    const r = walkImportGraph([join(root, "entry.js")]);
    expect([...r.packages.keys()]).toEqual(["kit"]);
    expect([...r.missing.keys()]).toEqual(["impl-sdk"]);
  });
});
