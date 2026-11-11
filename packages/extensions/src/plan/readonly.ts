// 计划模式下命令工具（bash / powershell）的只读判定（技术方案第 14.2 节）。
//
// 三种结果：
//   readonly  可以确定不改动任何东西（只读白名单里的命令、只读的 git 子命令），直接放行
//   write     明显会改动文件或系统（重定向、删除 / 移动、git 写操作、安装依赖等），一律拒绝
//   unknown   判断不了（测试、构建、脚本等），交给用户确认
// 判定偏保守：命令替换、编码命令、Invoke-Expression 一律当 unknown；管道、`;`、`&&`、`||` 拆开逐段判断，
// 任何一段是 write 整条就是 write，任何一段是 unknown 整条就是 unknown。

export type CommandClass = "readonly" | "write" | "unknown";

/** 两种 shell 共用的只读命令（小写，不含扩展名） */
const COMMON_READONLY = new Set([
  "rg",
  "fd",
  "grep",
  "egrep",
  "fgrep",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "ls",
  "dir",
  "tree",
  "pwd",
  "wc",
  "sort",
  "uniq",
  "diff",
  "file",
  "stat",
  "du",
  "df",
  "which",
  "where",
  "whoami",
  "hostname",
  "date",
  "echo",
  "printf",
  "type",
  "findstr",
  "uname",
  "env",
  "printenv",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "cut",
  "tr",
  "jq",
  "nl",
  "column",
  "true",
  "false",
  "test",
  "find",
]);

/** PowerShell 的只读 cmdlet 与常见别名（小写） */
const PS_READONLY = new Set([
  "get-childitem",
  "gci",
  "get-content",
  "gc",
  "get-item",
  "gi",
  "get-itemproperty",
  "gp",
  "get-location",
  "gl",
  "select-string",
  "sls",
  "test-path",
  "resolve-path",
  "split-path",
  "join-path",
  "measure-object",
  "measure",
  "select-object",
  "select",
  "where-object",
  "where",
  "?",
  "foreach-object",
  "%",
  "sort-object",
  "group-object",
  "format-table",
  "ft",
  "format-list",
  "fl",
  "format-wide",
  "out-string",
  "out-host",
  "get-command",
  "gcm",
  "get-help",
  "get-filehash",
  "get-date",
  "get-process",
  "gps",
  "get-service",
  "get-psdrive",
  "get-variable",
  "get-acl",
  "write-output",
  "write-host",
  "convertfrom-json",
  "convertto-json",
  "get-unique",
  "compare-object",
]);

/** 明显会修改的命令（小写） */
const WRITE_COMMANDS = new Set([
  "rm",
  "rmdir",
  "del",
  "erase",
  "rd",
  "mv",
  "move",
  "cp",
  "copy",
  "xcopy",
  "robocopy",
  "mkdir",
  "md",
  "touch",
  "ln",
  "chmod",
  "chown",
  "truncate",
  "dd",
  "shred",
  "tee",
  "sudo",
  "su",
  "kill",
  "taskkill",
  "shutdown",
  "reboot",
  "format",
  "vim",
  "vi",
  "nano",
  "code",
  "notepad",
  "remove-item",
  "ri",
  "move-item",
  "mi",
  "copy-item",
  "cpi",
  "new-item",
  "ni",
  "set-content",
  "sc",
  "add-content",
  "ac",
  "clear-content",
  "out-file",
  "set-item",
  "rename-item",
  "rni",
  "ren",
  "set-itemproperty",
  "new-itemproperty",
  "remove-itemproperty",
  "set-acl",
  "stop-process",
  "spps",
  "start-process",
  "saps",
  "stop-service",
  "start-service",
  "restart-service",
  "set-location",
  "invoke-webrequest",
  "iwr",
  "invoke-restmethod",
  "irm",
  "export-csv",
  "set-executionpolicy",
  "install-module",
  "expand-archive",
  "compress-archive",
]);

/** 只读的 git 子命令 */
const GIT_READONLY = new Set([
  "status",
  "log",
  "diff",
  "show",
  "blame",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "describe",
  "shortlog",
  "grep",
  "cat-file",
  "reflog",
  "whatchanged",
  "merge-base",
  "name-rev",
  "for-each-ref",
  "show-ref",
  "count-objects",
  "version",
  "help",
]);

/** 会改动仓库或远端的 git 子命令 */
const GIT_WRITE = new Set([
  "add",
  "commit",
  "push",
  "pull",
  "fetch",
  "merge",
  "rebase",
  "reset",
  "checkout",
  "switch",
  "restore",
  "rm",
  "mv",
  "clean",
  "stash",
  "cherry-pick",
  "revert",
  "am",
  "apply",
  "init",
  "clone",
  "tag",
  "worktree",
  "submodule",
  "gc",
  "prune",
  "notes",
  "update-ref",
]);

/** 包管理器的安装 / 修改类子命令 */
const PKG_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "pip", "pip3", "cargo", "winget"]);
const PKG_WRITE = new Set([
  "install",
  "i",
  "add",
  "remove",
  "rm",
  "uninstall",
  "un",
  "update",
  "up",
  "upgrade",
  "publish",
  "link",
  "unlink",
  "ci",
  "dedupe",
  "prune",
]);
const PKG_READONLY = new Set([
  "ls",
  "list",
  "outdated",
  "view",
  "info",
  "why",
  "audit",
  "show",
  "tree",
  "search",
  "--version",
  "-v",
]);

/** 按引号感知地把命令拆成段（管道、`;`、`&&`、`||`、换行） */
export function splitSegments(command: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  // PowerShell 脚本块 `{ … }` 里的管道与分号属于块内，不拆
  let depth = 0;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "{" || ch === "}") {
      depth = Math.max(0, depth + (ch === "{" ? 1 : -1));
      cur += ch;
      continue;
    }
    if (depth > 0) {
      cur += ch;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (ch === "|" || ch === ";" || ch === "\n" || ch === "\r") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** 去掉引号内的内容，便于查找重定向等特征（引号里的 `>` 不算） */
function unquoted(segment: string): string {
  return segment.replace(/'[^']*'|"[^"]*"/g, '""');
}

/** 把一段拆成词（引号内的空格不拆），去掉外层引号 */
function words(segment: string): string[] {
  const m = segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  return m.map((w) => w.replace(/^(['"])(.*)\1$/, "$2"));
}

/** 命令名规范化：去掉路径、`.exe` 等扩展名、PowerShell 的调用符 `&` */
function commandName(word: string): string {
  const base = word.replace(/^&/, "").split(/[\\/]/).pop() ?? word;
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

function classifySegment(segment: string, powershell: boolean): CommandClass {
  const bare = unquoted(segment);
  // 写文件的重定向：`>`、`>>`；只允许把输出丢弃或合并（2>$null、2>/dev/null、2>&1、>$null、>NUL）
  for (const m of bare.matchAll(/(?:^|[\s\d*])>>?\s*(&\d|[^\s|;&]*)/g)) {
    const target = (m[1] ?? "").toLowerCase();
    if (!["$null", "/dev/null", "nul", "&1", "&2"].includes(target)) return "write";
  }
  // 命令替换、脚本块执行、编码命令：内容判断不了
  // （PowerShell 的反引号是转义符，bash 的反引号是命令替换）
  if (/\$\(|<\(/.test(bare) || (!powershell && bare.includes("`"))) return "unknown";
  if (/(^|[\s;|&(])(iex|invoke-expression|invoke-command|icm)\b/i.test(bare)) return "unknown";

  const ws = words(segment);
  // 跳过 bash 的环境变量赋值前缀（FOO=1 cmd）
  while (ws.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0] as string)) ws.shift();
  const first = ws[0];
  if (first === undefined) return "readonly";
  if (!powershell && /^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) return "write";
  const name = commandName(first);
  const args = ws.slice(1);
  const sub = args.find((a) => !a.startsWith("-"))?.toLowerCase();

  if (WRITE_COMMANDS.has(name)) return "write";
  // 嵌套的 shell（bash -c、powershell -Command、cmd /c 等）：内容判断不了
  if (["bash", "sh", "zsh", "powershell", "pwsh", "cmd", "wsl"].includes(name)) return "unknown";
  if (name === "git") {
    // git -C <dir> <子命令>
    let i = 0;
    while (i < args.length && (args[i] as string).startsWith("-")) {
      i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
    }
    const gsub = args[i]?.toLowerCase();
    if (gsub === undefined) return "readonly";
    if (GIT_WRITE.has(gsub)) return "write";
    if (gsub === "branch" || gsub === "remote") {
      const rest = args.slice(i + 1);
      const listing = rest.every((a) =>
        ["-a", "-r", "-v", "-vv", "--list", "-l", "--show-current", "--all"].includes(a),
      );
      return listing ? "readonly" : "write";
    }
    if (gsub === "config") {
      const rest = args.slice(i + 1);
      return rest.some((a) => ["--get", "--list", "-l", "--get-all"].includes(a))
        ? "readonly"
        : "unknown";
    }
    return GIT_READONLY.has(gsub) ? "readonly" : "unknown";
  }
  if (PKG_MANAGERS.has(name)) {
    if (sub === undefined) return args.length ? "readonly" : "unknown";
    if (PKG_WRITE.has(sub)) return "write";
    return PKG_READONLY.has(sub) || args.includes("--version") ? "readonly" : "unknown";
  }
  if (name === "node" || name === "python" || name === "python3" || name === "rustc") {
    return args.length === 1 && /^(-v|--version|-V)$/.test(args[0] as string)
      ? "readonly"
      : "unknown";
  }
  if (name === "sed") {
    return args.some((a) => /^-i|^--in-place/.test(a)) ? "write" : "readonly";
  }
  if (name === "find") {
    return args.some((a) => ["-delete", "-exec", "-execdir", "-ok", "-fprint"].includes(a))
      ? "unknown"
      : "readonly";
  }
  if (COMMON_READONLY.has(name)) return "readonly";
  if (powershell && PS_READONLY.has(name)) {
    // ForEach-Object / Where-Object 的脚本块里可能有任意代码：块内再判断一次
    const block = /\{([\s\S]*)\}/.exec(segment)?.[1];
    if (block && ["foreach-object", "%", "where-object", "where", "?"].includes(name)) {
      if (classifyCommand(block, true) === "write") return "write";
      // 块里调用对象方法（$_.Delete()）或调用脚本（&）判断不了
      return /\.\w+\s*\(|&/.test(unquoted(block)) ? "unknown" : "readonly";
    }
    return "readonly";
  }
  // 变量读取（$x、$PSVersionTable）
  if (powershell && /^\$[\w:]+$/.test(first) && args.length === 0) return "readonly";
  return "unknown";
}

/** 判断一条命令；`powershell` 为 true 时按 PowerShell 语法（Windows 默认的命令工具） */
export function classifyCommand(command: string, powershell = false): CommandClass {
  const segments = splitSegments(command);
  let result: CommandClass = "readonly";
  for (const s of segments) {
    const c = classifySegment(s, powershell);
    if (c === "write") return "write";
    if (c === "unknown") result = "unknown";
  }
  return result;
}
