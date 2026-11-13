// dist/ 组装用的纯函数（scripts/build-core.mjs、scripts/smoke-core-rpc.mjs 共用，单测见 core-dist.test.ts）：
// SHA-256、SHASUMS256.txt 解析、最小 zip 读取（只解出需要的文件）、按模式挑选文件、manifest 生成与校验、
// Core 许可文件随产物分发。
// 只用 Node 内置模块，不引入解压依赖。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

export const MANIFEST_FILE = "manifest.json";
export const MANIFEST_SCHEMA = 1;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 校验字节内容的 SHA-256，不匹配时抛错（label 用于错误信息）。 */
export function assertSha256(bytes, expected, label) {
  if (!SHA256_HEX.test(String(expected ?? ""))) throw new Error(`${label}：期望哈希格式不正确`);
  const actual = sha256(bytes);
  if (actual !== expected)
    throw new Error(`${label} SHA-256 不匹配：期望 ${expected}，实际 ${actual}`);
}

/** 解析 SHASUMS256.txt（每行 "<64 位十六进制>  <文件名>"），返回 Map<文件名, 哈希>。 */
export function parseShasums(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(\S+)$/);
    if (m) map.set(m[2], m[1].toLowerCase());
  }
  return map;
}

// ---- zip 读取（只支持存储与 deflate，不支持 zip64 与加密；官方 Node.js 发行包满足这些条件）----

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** 列出 zip 中央目录里的条目。 */
export function listZipEntries(buf) {
  // 中央目录结束记录在末尾 22 字节 + 最长 65535 字节注释之内，从后往前找
  const min = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 zip 文件（未找到中央目录结束记录）");
  const count = buf.readUInt16LE(eocd + 10);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cenOffset === 0xffffffff) throw new Error("不支持 zip64 格式");

  const entries = [];
  let p = cenOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG)
      throw new Error(`zip 中央目录第 ${i + 1} 项损坏`);
    const flags = buf.readUInt16LE(p + 8);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const entry = {
      name: buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      encrypted: (flags & 0x1) !== 0,
      crc32: buf.readUInt32LE(p + 16),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      localHeaderOffset: buf.readUInt32LE(p + 42),
    };
    if (
      entry.compressedSize === 0xffffffff ||
      entry.size === 0xffffffff ||
      entry.localHeaderOffset === 0xffffffff
    )
      throw new Error(`不支持 zip64 条目：${entry.name}`);
    entries.push(entry);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 读出单个条目的内容并校验 CRC32 与长度。 */
export function readZipEntry(buf, entry) {
  if (entry.encrypted) throw new Error(`不支持加密条目：${entry.name}`);
  const p = entry.localHeaderOffset;
  if (buf.readUInt32LE(p) !== LOC_SIG) throw new Error(`zip 本地文件头损坏：${entry.name}`);
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const raw = buf.subarray(start, start + entry.compressedSize);
  let data;
  if (entry.method === 0) data = Buffer.from(raw);
  else if (entry.method === 8) data = inflateRawSync(raw);
  else throw new Error(`不支持的压缩方式 ${entry.method}：${entry.name}`);
  if (data.length !== entry.size) throw new Error(`zip 条目长度不符：${entry.name}`);
  if (crc32(data) >>> 0 !== entry.crc32 >>> 0)
    throw new Error(`zip 条目 CRC32 不符：${entry.name}`);
  return data;
}

/**
 * 从 Node.js 发行包条目中只挑出需要的文件（如 node.exe、LICENSE）。
 * 发行包所有文件都在唯一的顶层目录（node-v<版本>-<平台>/）下；只接受该目录下与 wanted 完全同名的文件，
 * npm、corepack、文档、示例一律跳过。返回 Map<文件名, 条目>，缺任何一个都抛错。
 */
export function selectRuntimeEntries(entries, topDir, wanted) {
  const picked = new Map();
  for (const entry of entries) {
    const name = entry.name.replaceAll("\\", "/");
    if (!name.startsWith(`${topDir}/`)) continue;
    const rest = name.slice(topDir.length + 1);
    if (!wanted.includes(rest)) continue;
    if (picked.has(rest)) throw new Error(`发行包中重复出现 ${rest}`);
    picked.set(rest, entry);
  }
  const missing = wanted.filter((f) => !picked.has(f));
  if (missing.length) throw new Error(`发行包中缺少：${missing.join(", ")}`);
  return picked;
}

// ---- 内置 Python（ADR 0010）----

/**
 * zip 条目的安全相对路径：统一为 /，去掉目录条目（以 / 结尾，返回 null）；
 * 绝对路径、盘符、含 .. 或空段的路径一律抛错，防止解包写到目标目录之外。
 */
export function safeZipPath(name) {
  const p = name.replaceAll("\\", "/");
  if (p.endsWith("/")) return null;
  const parts = p.split("/");
  if (
    p.startsWith("/") ||
    /^[A-Za-z]:/.test(p) ||
    parts.some((s) => s === "" || s === "." || s === "..")
  )
    throw new Error(`zip 条目路径不安全：${name}`);
  return p;
}

/** embed 包里 `python<主><次>._pth` 的文件名（如 python314._pth）；找不到或不止一个都抛错 */
export function findPthFile(names) {
  const found = names.filter((n) => /^python3\d+\._pth$/.test(n));
  if (found.length !== 1)
    throw new Error(`embed 包中应有且只有一个 python3xx._pth，实际：${found.join(", ") || "无"}`);
  return found[0];
}

/**
 * 改写 embed 包的 `._pth`：加入 `Lib\site-packages`（内置 pip 与 sitecustomize 所在）并启用 `import site`。
 * `._pth` 存在时 Python 处于隔离模式（忽略 PYTHON* 环境变量与注册表），sys.path 只由这里决定；
 * 用户自己安装的包由 sitecustomize 按 PRIMUS_PYTHON_PACKAGES 加入（见 PYTHON_SITECUSTOMIZE）。
 */
export function patchPythonPth(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#") && l !== "import site");
  if (!lines.some((l) => /^python3\d+\.zip$/.test(l)))
    throw new Error("._pth 中缺少标准库 python3xx.zip，embed 包布局可能有变");
  if (!lines.some((l) => l.toLowerCase() === "lib\\site-packages"))
    lines.push("Lib\\site-packages");
  lines.push("import site");
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * 写进 `Lib\site-packages\sitecustomize.py`。embed 包的 `._pth` 让解释器运行在隔离模式（忽略 PYTHON* 环境变量、
 * `safe_path`），这里补回普通 Python 的三处行为：
 * 1. `PYTHONPATH`：pip 默认的隔离构建（virtual）靠它注入构建环境自己的 sitecustomize；把这些目录放到最前并执行
 *    其中的 sitecustomize。只有 pip 的隔离构建目录（临时目录下的 `pip-build-env-xxx\site`）不加入用户包，其他钩子照常加入。
 * 2. 脚本目录：`python main.py` 的同目录模块、`python -m pkg` 的当前目录、`-c` / 交互模式的 ''，按标准规则放到 sys.path[0]。
 *    命令行显式给出 `-I` / `-E` 时不恢复 `PYTHONPATH`，`-I` / `-P` 时不恢复脚本目录（以 sys.orig_argv 判断）。
 * 3. 用户包与字节码：加入薄壳经 PRIMUS_PYTHON_PACKAGES 指定、数据目录中的包目录（pip 经 PIP_TARGET 装到那里），
 *    `.pyc` 缓存重定向到同级 `pycache`；没有该变量时不写字节码，避免在安装目录生成 `__pycache__`（约束 C2）。
 */
export const PYTHON_SITECUSTOMIZE = `# 乾元 Primus 内置 Python：补回 ._pth 隔离模式关掉的行为（ADR 0010）
import os
import site
import sys


def _explicit_flags():
    # 命令行上显式给出的解释器选项（-I / -E / -P 等）：用户明确要求的隔离不能被下面的兼容逻辑放宽
    flags = set()
    args = list(getattr(sys, "orig_argv", [])[1:])
    while args:
        arg = args.pop(0)
        if arg == "--" or arg == "-" or not arg.startswith("-") or arg.startswith("--"):
            break
        if arg[1] in "cm":
            break
        for index, ch in enumerate(arg[1:], 1):
            if ch in "WX":
                if index == len(arg) - 1 and args:
                    args.pop(0)
                break
            flags.add(ch)
    return flags


def _primus_setup():
    explicit = _explicit_flags()
    packages = os.environ.get("PRIMUS_PYTHON_PACKAGES")
    if packages:
        sys.pycache_prefix = os.path.join(os.path.dirname(os.path.abspath(packages)), "pycache")
    else:
        sys.dont_write_bytecode = True

    hooks = []
    isolated_build = False
    if not explicit & {"I", "E"}:
        extra = [p for p in os.environ.get("PYTHONPATH", "").split(os.pathsep) if p]
        for entry in reversed(extra):
            sys.path.insert(0, entry)
        for entry in extra:
            candidate = os.path.join(entry, "sitecustomize.py")
            if os.path.isfile(candidate):
                hooks.append(candidate)
                # pip 默认隔离构建：<临时目录>/pip-build-env-*/site/sitecustomize.py，构建环境中不放用户包
                parent = os.path.basename(os.path.dirname(os.path.abspath(entry)))
                if os.path.basename(os.path.abspath(entry)) == "site" and parent.startswith("pip-build-env-"):
                    isolated_build = True
                break

    if sys.flags.safe_path and not explicit & {"I", "P"}:
        argv0 = sys.argv[0] if sys.argv else ""
        if argv0 in ("", "-c"):
            path0 = ""
        elif argv0 == "-m":
            path0 = os.getcwd()
        elif os.path.isdir(argv0) or argv0.lower().endswith((".zip", ".pyz")):
            path0 = argv0
        else:
            path0 = os.path.dirname(os.path.realpath(argv0))
        sys.path.insert(0, path0)

    if packages and not isolated_build:
        site.addsitedir(packages)
    for hook in hooks:
        with open(hook, encoding="utf-8") as fp:
            code = compile(fp.read(), hook, "exec")
        exec(code, {"__name__": "sitecustomize", "__file__": hook})


_primus_setup()
del _primus_setup
`;

/** `pip` / `pip3` 命令（PowerShell 与 cmd 按 PATHEXT 找到 .cmd）；`-B` 不在安装目录写字节码。bash 中用 `python -m pip` */
export const PIP_CMD = '@"%~dp0python.exe" -B -m pip %*\r\n';

// ---- 文件挑选与 manifest ----

/** 把只含 * 与 ** 的简单模式（/ 分隔）转成正则；* 不跨目录，** 可匹配任意层级。 */
export function globToRegExp(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** 递归列出目录下所有文件，返回以 / 分隔、排好序的相对路径。 */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/** 在相对路径列表中挑出匹配任一模式的文件。 */
export function pickFiles(files, patterns) {
  const res = patterns.map(globToRegExp);
  return files.filter((f) => res.some((re) => re.test(f)));
}

/**
 * Core 运行时用的 package.json：只保留名称、版本、模块类型、品牌配置等运行时读取的字段，
 * 去掉脚本、依赖、入口声明（产物里不含未打包的入口）等构建期字段。
 */
const BUILD_ONLY_FIELDS = [
  "scripts",
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "files",
  "bin",
  "main",
  "types",
  "exports",
  "keywords",
  "repository",
  "homepage",
  "bugs",
];
export function runtimePackageJson(pkg) {
  const out = { ...pkg };
  for (const field of BUILD_ONLY_FIELDS) delete out[field];
  out.type = "module";
  return out;
}

/** 生成 manifest：dir 下（manifest 自身与 skip 中的顶层目录除外）每个文件的大小与 SHA-256。 */
export function buildManifest(dir, meta, skip = []) {
  const files = listFiles(dir)
    .filter((f) => f !== MANIFEST_FILE && !skip.some((s) => f === s || f.startsWith(`${s}/`)))
    .map((path) => {
      const bytes = readFileSync(join(dir, path));
      return { path, size: bytes.length, sha256: sha256(bytes) };
    });
  return { schema: MANIFEST_SCHEMA, ...meta, files };
}

/** 按 manifest 校验目录：返回问题列表（空数组即通过）。不在 manifest 中的文件只在 strict 时报错。 */
export function verifyManifest(dir, manifest, { skip = [], strict = true } = {}) {
  const problems = [];
  const listed = new Set();
  for (const { path, size, sha256: expected } of manifest.files ?? []) {
    listed.add(path);
    let bytes;
    try {
      bytes = readFileSync(join(dir, path));
    } catch {
      problems.push(`缺少文件：${path}`);
      continue;
    }
    if (bytes.length !== size || sha256(bytes) !== expected) problems.push(`内容不符：${path}`);
  }
  if (strict) {
    for (const f of listFiles(dir)) {
      if (f === MANIFEST_FILE || listed.has(f)) continue;
      if (skip.some((s) => f === s || f.startsWith(`${s}/`))) continue;
      problems.push(`多出文件：${f}`);
    }
  }
  return problems;
}

/** Core 上游许可文件（agent-core/LICENSE，MIT）：随 dist/agent-core 分发到安装目录，文件名保留 LICENSE */
export const CORE_LICENSE_FILE = "LICENSE";

/**
 * MIT 许可正文（版权行之后的全部内容，按 SPDX MIT 标准文本审核）。上游 LICENSE 须为
 * 「MIT License」标题 + 一或多行 Copyright + 本正文；比较时只归一化空白（换行与缩进差异不影响）。
 */
export const MIT_LICENSE_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const normalizeSpace = (s) => s.replace(/\s+/g, " ").trim();

/** 判断许可文本是否为完整的 MIT 许可：标题、至少一行版权声明、与 MIT_LICENSE_BODY 一致的完整正文 */
export function isCompleteMitLicense(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let i = 0;
  const skipBlank = () => {
    while (i < lines.length && lines[i].trim() === "") i++;
  };
  skipBlank();
  if (lines[i]?.trim() !== "MIT License") return false;
  i++;
  skipBlank();
  let copyrights = 0;
  while (i < lines.length && /^\s*Copyright\b/i.test(lines[i])) {
    copyrights++;
    i++;
    skipBlank();
  }
  if (copyrights === 0) return false;
  return normalizeSpace(lines.slice(i).join("\n")) === normalizeSpace(MIT_LICENSE_BODY);
}

/**
 * 把 Core 的上游 MIT 许可文件原样复制到 destDir/LICENSE（MIT 要求随软件副本附带版权与许可声明）。
 * 上游许可若不再是完整的 MIT 文本（文件缺失、截断或内容变化），构建直接失败，需人工复核再调整分发方式。
 * 文件在组装阶段写入，之后生成的 manifest 自然收录它，安装后由 msi-smoke.ps1 检查。
 */
export function copyCoreLicense(coreDir, destDir) {
  const from = join(coreDir, CORE_LICENSE_FILE);
  let bytes;
  try {
    bytes = readFileSync(from);
  } catch {
    throw new Error(`未找到 Core 许可文件 ${from}`);
  }
  if (!isCompleteMitLicense(bytes.toString("utf8")))
    throw new Error(`${from} 不是预期的 MIT 许可文本，请复核上游许可后再调整分发方式`);
  writeFileSync(join(destDir, CORE_LICENSE_FILE), bytes);
  return CORE_LICENSE_FILE;
}
