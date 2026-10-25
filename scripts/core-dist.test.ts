import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSha256,
  buildManifest,
  CORE_LICENSE_FILE,
  copyCoreLicense,
  globToRegExp,
  listFiles,
  listZipEntries,
  parseShasums,
  pickFiles,
  readZipEntry,
  runtimePackageJson,
  selectRuntimeEntries,
  sha256,
  verifyManifest,
  // @ts-expect-error 纯 JS 脚本，无类型声明
} from "./core-dist.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "core-dist-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** 生成最小 zip（存储或 deflate），用于测试读取与过滤。 */
function makeZip(files: { name: string; data: string; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const data = Buffer.from(f.data);
    const body = f.deflate ? deflateRawSync(data) : data;
    const name = Buffer.from(f.name);
    const crc = crc32(data);
    const method = f.deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cen = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cen.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cen, eocd]);
}

const TOP = "node-v24.22.1-win-x64";
const DIST_ZIP = () =>
  makeZip([
    { name: `${TOP}/`, data: "" },
    { name: `${TOP}/node.exe`, data: "MZ fake node".repeat(100), deflate: true },
    { name: `${TOP}/LICENSE`, data: "license text" },
    { name: `${TOP}/README.md`, data: "readme" },
    { name: `${TOP}/npm.cmd`, data: "npm" },
    { name: `${TOP}/node_modules/npm/package.json`, data: "{}" },
    { name: `${TOP}/node_modules/npm/node.exe`, data: "nested" },
    { name: "other/node.exe", data: "outside" },
  ]);

describe("sha256 / assertSha256", () => {
  it("计算并校验哈希", () => {
    const h = sha256(Buffer.from("abc"));
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(() => assertSha256(Buffer.from("abc"), h, "x")).not.toThrow();
    expect(() => assertSha256(Buffer.from("abd"), h, "x")).toThrow(/SHA-256 不匹配/);
    expect(() => assertSha256(Buffer.from("abc"), "zz", "x")).toThrow(/格式不正确/);
  });
});

describe("parseShasums", () => {
  it("解析官方 SHASUMS256.txt 格式，忽略无关行", () => {
    const a = "a".repeat(64);
    const b = "B".repeat(64);
    const map = parseShasums(
      `${a}  node-v24.22.1-win-x64.zip\r\n${b} *node.tar.xz\n\n-----BEGIN\n`,
    );
    expect(map.get("node-v24.22.1-win-x64.zip")).toBe(a);
    expect(map.get("node.tar.xz")).toBe("b".repeat(64));
    expect(map.size).toBe(2);
  });
});

describe("zip 读取", () => {
  it("列出条目并读出存储/deflate 内容", () => {
    const zip = DIST_ZIP();
    const entries = listZipEntries(zip);
    expect(entries.map((e: { name: string }) => e.name)).toContain(`${TOP}/node.exe`);
    const exe = entries.find((e: { name: string }) => e.name === `${TOP}/node.exe`);
    expect(exe.method).toBe(8);
    expect(readZipEntry(zip, exe).toString()).toBe("MZ fake node".repeat(100));
    const lic = entries.find((e: { name: string }) => e.name === `${TOP}/LICENSE`);
    expect(readZipEntry(zip, lic).toString()).toBe("license text");
  });

  it("CRC32 不符时报错", () => {
    const zip = DIST_ZIP();
    const lic = listZipEntries(zip).find((e: { name: string }) => e.name === `${TOP}/LICENSE`);
    expect(() => readZipEntry(zip, { ...lic, crc32: (lic.crc32 + 1) >>> 0 })).toThrow(/CRC32/);
  });

  it("非 zip 内容报错", () => {
    expect(() => listZipEntries(Buffer.alloc(100))).toThrow(/不是有效的 zip/);
  });
});

describe("selectRuntimeEntries", () => {
  it("只取顶层目录下的 node.exe 与 LICENSE，跳过 npm、文档与嵌套同名文件", () => {
    const picked = selectRuntimeEntries(listZipEntries(DIST_ZIP()), TOP, ["node.exe", "LICENSE"]);
    expect([...picked.keys()].sort()).toEqual(["LICENSE", "node.exe"]);
    expect(picked.get("node.exe").name).toBe(`${TOP}/node.exe`);
  });

  it("缺少文件时报错", () => {
    expect(() =>
      selectRuntimeEntries(listZipEntries(DIST_ZIP()), TOP, ["node.exe", "node.pdb"]),
    ).toThrow(/缺少：node.pdb/);
  });
});

describe("globToRegExp / pickFiles", () => {
  it("* 不跨目录，** 匹配任意层级", () => {
    expect(globToRegExp("lib/*.cjs").test("lib/jiti.cjs")).toBe(true);
    expect(globToRegExp("lib/*.cjs").test("lib/sub/jiti.cjs")).toBe(false);
    expect(globToRegExp("dist/bundle/**").test("dist/bundle/chunks/a.js")).toBe(true);
    expect(globToRegExp("a/**/b.js").test("a/b.js")).toBe(true);
    expect(globToRegExp("a/**/b.js").test("a/x/y/b.js")).toBe(true);
    expect(globToRegExp("a.json").test("aXjson")).toBe(false);
  });

  it("按模式挑选文件，排除类型声明与文档", () => {
    const files = ["LICENSE", "README.md", "lib/jiti.cjs", "lib/jiti.d.cts", "lib/jiti.mjs"];
    expect(pickFiles(files, ["LICENSE", "lib/*.cjs", "lib/*.mjs"])).toEqual([
      "LICENSE",
      "lib/jiti.cjs",
      "lib/jiti.mjs",
    ]);
  });
});

describe("runtimePackageJson", () => {
  it("去掉构建期字段，保留名称、版本与品牌配置，强制 ESM", () => {
    const out = runtimePackageJson({
      name: "core",
      version: "1.4.0",
      brand: { name: "primus" },
      scripts: { build: "x" },
      dependencies: { a: "1" },
      main: "./dist/index.js",
      exports: {},
      bin: {},
      license: "MIT",
    });
    expect(out).toEqual({
      name: "core",
      version: "1.4.0",
      brand: { name: "primus" },
      license: "MIT",
      type: "module",
    });
  });
});

describe("manifest", () => {
  it("生成文件列表与哈希，跳过 manifest 自身与保留目录，并可校验", () => {
    const dir = fixture({
      "rpc-entry.js": "entry",
      "dist/bundle/a.js": "a",
      "extensions/primus-bundle.js": "ext",
      "manifest.json": "{}",
    });
    const m = buildManifest(dir, { core: { version: "1.4.0" } }, ["extensions"]);
    expect(m.schema).toBe(1);
    expect(m.core.version).toBe("1.4.0");
    expect(m.files.map((f: { path: string }) => f.path)).toEqual([
      "dist/bundle/a.js",
      "rpc-entry.js",
    ]);
    expect(m.files[1]).toEqual({ path: "rpc-entry.js", size: 5, sha256: sha256("entry") });
    expect(verifyManifest(dir, m, { skip: ["extensions"] })).toEqual([]);

    writeFileSync(join(dir, "dist/bundle/a.js"), "changed");
    writeFileSync(join(dir, "extra.js"), "x");
    rmSync(join(dir, "rpc-entry.js"));
    expect(verifyManifest(dir, m, { skip: ["extensions"] }).sort()).toEqual([
      "内容不符：dist/bundle/a.js",
      "多出文件：extra.js",
      "缺少文件：rpc-entry.js",
    ]);
  });

  it("listFiles 返回以 / 分隔的排序相对路径", () => {
    const dir = fixture({ "b.txt": "", "a/c.txt": "", "a/b/d.txt": "" });
    expect(listFiles(dir)).toEqual(["a/b/d.txt", "a/c.txt", "b.txt"]);
  });
});

describe("Core 许可文件", () => {
  const MIT =
    "MIT License\n\nCopyright (c) 2025 Someone\n\nPermission is hereby granted, free of charge, to any person\n";

  it("原样复制到 dist/agent-core/LICENSE，并被 manifest 收录", () => {
    const core = fixture({ LICENSE: MIT });
    const dist = fixture({ "rpc-entry.js": "entry" });
    expect(copyCoreLicense(core, dist)).toBe("LICENSE");
    expect(CORE_LICENSE_FILE).toBe("LICENSE");
    expect(readFileSync(join(dist, "LICENSE"), "utf8")).toBe(MIT);
    const m = buildManifest(dist, {});
    expect(m.files).toContainEqual({ path: "LICENSE", size: MIT.length, sha256: sha256(MIT) });
    expect(verifyManifest(dist, m)).toEqual([]);
  });

  it("上游许可缺失或不再是 MIT 时构建失败", () => {
    const dist = fixture({});
    expect(() => copyCoreLicense(fixture({}), dist)).toThrow(/未找到 Core 许可文件/);
    expect(() =>
      copyCoreLicense(fixture({ LICENSE: "Apache License\nVersion 2.0" }), dist),
    ).toThrow(/不是预期的 MIT/);
    expect(existsSync(join(dist, "LICENSE"))).toBe(false);
  });

  it("仓库内 agent-core/LICENSE 是 MIT，可直接分发", () => {
    const dist = fixture({});
    expect(() =>
      copyCoreLicense(fileURLToPath(new URL("../agent-core", import.meta.url)), dist),
    ).not.toThrow();
  });
});
