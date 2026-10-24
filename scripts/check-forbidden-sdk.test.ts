import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import {
  compileRules,
  importSpecifiers,
  packageName,
  pnpmLockPackages,
  run,
} from "./check-forbidden-sdk.mjs";

const RULES = ["@google/*", "@aws-sdk/client-bedrock-runtime", "groq-sdk"];
// 夹具包名由片段拼接，经变量拼进源码字符串：本文件不出现完整被禁包名，避免被扫描器或命名检查误报
const GENAI = ["@google", "genai"].join("/");
const dirs: string[] = [];

function fixture(files: Record<string, string>, enforceCore = false): string {
  const root = mkdtempSync(join(tmpdir(), "forbidden-sdk-"));
  dirs.push(root);
  const all = {
    "scripts/forbidden-sdk.json": JSON.stringify({ forbidden: RULES, enforceCore }),
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
});
