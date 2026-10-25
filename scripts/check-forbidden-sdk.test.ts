import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import {
  compileRules,
  importSpecifiers,
  packageName,
  pnpmLockPackages,
  run,
  sbomPackages,
  writeSelfTestFixture,
} from "./check-forbidden-sdk.mjs";

const RULES = ["@google/*", "@aws-sdk/client-bedrock-runtime", "groq-sdk"];
// 夹具包名由片段拼接，经变量拼进源码字符串：本文件不出现完整被禁包名，避免被扫描器或命名检查误报
const GENAI = ["@google", "genai"].join("/");
const dirs: string[] = [];

const SCRIPT = fileURLToPath(new URL("./check-forbidden-sdk.mjs", import.meta.url));

function fixture(
  files: Record<string, string>,
  enforceCore = false,
  extra: Record<string, unknown> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "forbidden-sdk-"));
  dirs.push(root);
  const all = {
    "scripts/forbidden-sdk.json": JSON.stringify({ forbidden: RULES, enforceCore, ...extra }),
    "package.json": JSON.stringify({ name: "fixture", devDependencies: { vitest: "5.0.5" } }),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("check-forbidden-sdk", () => {
  it("规则支持精确包名与 scope 通配", () => {
    const isForbidden = compileRules(RULES);
    expect(isForbidden(GENAI)).toBe(true);
    expect(isForbidden("@aws-sdk/client-bedrock-runtime")).toBe(true);
    expect(isForbidden("@aws-sdk/client-s3")).toBe(false);
    expect(isForbidden("openai")).toBe(false);
    expect(isForbidden("groq-sdk-extra")).toBe(false);
  });

  it("从说明符取包名，忽略相对路径与内置模块", () => {
    expect(packageName(`${GENAI}/web`)).toBe(GENAI);
    expect(packageName("groq-sdk/resources")).toBe("groq-sdk");
    expect(packageName("./local")).toBeNull();
    expect(packageName("node:fs")).toBeNull();
  });

  it("识别各种导入写法", () => {
    const code = `import a from "x";\nimport "y";\nexport { b } from "z";\nconst c = require("w");\nawait import("v");`;
    expect(importSpecifiers(code).sort()).toEqual(["v", "w", "x", "y", "z"]);
  });

  it("解析 pnpm-lock.yaml 的包名", () => {
    const lock = `lockfileVersion: '9.0'\n\npackages:\n\n  '${GENAI}@1.0.0':\n    resolution: {}\n\n  vitest@5.0.5:\n    resolution: {}\n`;
    expect([...pnpmLockPackages(lock)].sort()).toEqual([GENAI, "vitest"]);
  });

  it("干净的工作区通过", () => {
    const root = fixture({ "apps/a/src/index.ts": 'import OpenAI from "openai";' });
    expect(run(root).findings).toEqual([]);
  });

  it("工作区依赖或导入中出现被禁 SDK 时失败", () => {
    const root = fixture({
      "apps/a/package.json": JSON.stringify({ dependencies: { "groq-sdk": "1.0.0" } }),
      "packages/b/src/x.ts": `const g = await import("${GENAI}");`,
    });
    expect(run(root).findings).toEqual([
      "apps/a/package.json（dependencies）: groq-sdk",
      `packages/b/src/x.ts（导入）: ${GENAI}`,
    ]);
  });

  it("Core 中的发现在 enforceCore 关闭时只告警，开启时失败", () => {
    const lock = JSON.stringify({
      packages: { "": {}, "node_modules/@aws-sdk/client-bedrock-runtime": { version: "3.0.0" } },
    });
    const off = run(fixture({ "agent-core/package-lock.json": lock }, false));
    expect(off.findings).toEqual([]);
    expect(off.coreWarnings).toEqual([
      "agent-core/package-lock.json: @aws-sdk/client-bedrock-runtime",
    ]);
    const on = run(fixture({ "agent-core/package-lock.json": lock }, true));
    expect(on.findings).toEqual(["agent-core/package-lock.json: @aws-sdk/client-bedrock-runtime"]);
  });

  it("导入图：被禁 SDK 只经第三方包传递引入时也能发现，并给出导入链", () => {
    const root = fixture(
      {
        "apps/web/src/app/page.tsx": 'import { draw } from "chart-kit";',
        "apps/web/node_modules/chart-kit/package.json": JSON.stringify({ name: "chart-kit" }),
        "apps/web/node_modules/chart-kit/index.js": `module.exports = require("${GENAI}");`,
        [`apps/web/node_modules/${GENAI}/package.json`]: JSON.stringify({ name: GENAI }),
        [`apps/web/node_modules/${GENAI}/index.js`]: "module.exports = {};",
      },
      false,
      { importGraph: [{ name: "前端", entries: ["apps/web/src/app/**/*.tsx"], required: true }] },
    );
    const { findings, graphs } = run(root);
    expect(graphs).toEqual([{ name: "前端", entries: 1, files: 3, packages: 2, unresolved: [] }]);
    expect(findings).toEqual([
      `导入图 前端：apps/web/src/app/page.tsx → 「chart-kit」 → apps/web/node_modules/chart-kit/index.js → 「${GENAI}」: ${GENAI}`,
    ]);
  });

  it("导入图入口缺失：required 总是失败，其余入口仅在严格模式下失败", () => {
    const extra = {
      importGraph: [
        { name: "扩展", entries: ["packages/ext/src/index.ts"], required: true },
        { name: "Core", entries: ["agent-core/dist/rpc-entry.js"], core: true, hint: "先构建" },
      ],
    };
    const root = fixture({}, true, extra);
    const loose = run(root);
    expect(loose.findings).toEqual(["导入图 扩展：入口 packages/ext/src/index.ts 不存在"]);
    expect(loose.skipped).toEqual(["Core：入口 agent-core/dist/rpc-entry.js 不存在（先构建）"]);
    expect(run(root, { strict: true }).findings).toHaveLength(2);
  });

  it("导入图部分入口缺失：缺失的精确路径计入缺失、无匹配的 glob 单独提示，其余入口照常遍历", () => {
    const root = fixture(
      {
        "apps/web/src/app/page.tsx": `import "${GENAI}";`,
        [`apps/web/node_modules/${GENAI}/package.json`]: JSON.stringify({ name: GENAI }),
        [`apps/web/node_modules/${GENAI}/index.js`]: "module.exports = {};",
      },
      true,
      {
        importGraph: [
          {
            name: "前端",
            entries: ["apps/web/src/app/**/*.tsx", "apps/web/src/app/**/*.ts", "apps/web/x.js"],
          },
        ],
      },
    );
    const { findings, skipped, graphs } = run(root);
    expect(skipped).toEqual([
      "前端：入口 apps/web/x.js 不存在",
      "前端：入口模式 apps/web/src/app/**/*.ts 无匹配文件",
    ]);
    expect(run(root, { strict: true }).findings).toContain(
      "导入图 前端：入口 apps/web/x.js 不存在",
    );
    expect(graphs.map((g: { entries: number }) => g.entries)).toEqual([1]);
    expect(findings).toContain(`导入图 前端：apps/web/src/app/page.tsx → 「${GENAI}」: ${GENAI}`);
  });

  it("导入图：第一方文件中无法解析的脚本导入会被统计，.css 等资源不计", () => {
    const root = fixture(
      {
        "apps/web/src/app/page.tsx": 'import "./gone";\nimport "./page.css";\nimport "~/alias/x";',
      },
      true,
      { importGraph: [{ name: "前端", entries: ["apps/web/src/app/**/*.tsx"], required: true }] },
    );
    const { graphs } = run(root);
    expect(graphs[0].unresolved).toEqual(["apps/web/src/app/page.tsx: ./gone"]);
  });

  it("解析 pnpm 与 npm 生成的 CycloneDX 组件名", () => {
    const bom = {
      bomFormat: "CycloneDX",
      components: [
        { group: "@wdio", name: "globals", version: "1", purl: "pkg:npm/%40wdio/globals@1" },
        { name: "chalk", version: "5", purl: "pkg:npm/chalk@5" },
        { group: "@x", name: "y", version: "2", components: [{ name: "@a/b", version: "3" }] },
      ],
    };
    expect(sbomPackages(bom).map((c: { name: string }) => c.name)).toEqual([
      "@wdio/globals",
      "chalk",
      "@x/y",
      "@a/b",
    ]);
    expect(() => sbomPackages({ bomFormat: "SPDX" })).toThrow();
  });

  it("SBOM 中出现被禁 SDK 时失败；严格模式下缺少必需 SBOM 也失败", () => {
    const sbom = { dir: "dist/sbom", required: ["ws.cdx.json"], core: ["core.cdx.json"] };
    const bom = (name: string) =>
      JSON.stringify({ bomFormat: "CycloneDX", components: [{ name, version: "1.0.0" }] });
    const root = fixture(
      { "dist/sbom/ws.cdx.json": bom("groq-sdk"), "dist/sbom/core.cdx.json": bom("openai") },
      true,
      { sbom },
    );
    expect(run(root).findings).toEqual(["SBOM dist/sbom/ws.cdx.json（1.0.0）: groq-sdk"]);
    const missing = fixture({}, true, { sbom });
    expect(run(missing).findings).toEqual([]);
    expect(run(missing, { strict: true }).findings).toEqual([
      "SBOM dist/sbom/ws.cdx.json 不存在（先运行 pnpm build:sbom）",
    ]);
  });

  it.each([
    ["clean", 0],
    ["graph", 1],
    ["sbom", 1],
  ])("命令行：%s 夹具的退出码为 %i", (kind, code) => {
    const root = writeSelfTestFixture(kind, GENAI);
    dirs.push(root);
    const r = spawnSync(process.execPath, [SCRIPT, "--root", root, "--strict"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(code);
    if (code !== 0) expect(r.stderr).toContain(GENAI);
  });

  it("命令行负向自检通过", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--self-test"], { encoding: "utf8" });
    expect(r.stdout).toContain("负向自检通过");
    expect(r.status).toBe(0);
  });
});
