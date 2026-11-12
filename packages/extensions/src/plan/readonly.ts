// 计划模式下命令工具（bash / powershell）的只读判定（技术方案第 14.2 节）。
//
// 三种结果：
//   readonly  可以确定不改动任何东西（只读白名单里的命令、只读的 git 子命令），直接放行
//   write     明显会改动文件或系统（重定向、删除 / 移动、git 写操作、安装依赖等），一律拒绝
//   unknown   判断不了（测试、构建、脚本等），交给用户确认
// 判定偏保守：命令替换、编码命令、Invoke-Expression、带路径的命令一律当 unknown；
// 管道、`;`、`&&`、`||`、bash 的后台 `&` 拆开逐段判断，
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

/** 子命令前允许出现的 git 全局选项（不带参数的） */
const GIT_GLOBAL_FLAGS = new Set([
  "--no-pager",
  "-P",
  "--no-optional-locks",
  "--bare",
  "--literal-pathspecs",
  "--no-replace-objects",
  "--version",
  "--help",
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

/** 按引号感知地把命令拆成段（管道、`;`、`&&`、`||`、换行；bash 下还有后台运行的单个 `&`） */
export function splitSegments(command: string, powershell = false): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  // PowerShell 脚本块 `{ … }` 里的管道与分号属于块内，不拆。bash 的花括号不是块（`ls {; touch x; echo }`
  // 里的 `;` 照样分隔命令），照常拆段
  let depth = 0;
  // 转义符（bash 的 \，PowerShell 的 `）后面的字符是字面量：\; 不拆段，\' 不开始引号
  const esc = powershell ? "`" : "\\";
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;
    if (ch === esc && quote !== "'" && i + 1 < command.length) {
      cur += ch + command[i + 1];
      i++;
      continue;
    }
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
    if (powershell && (ch === "{" || ch === "}")) {
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
    // bash 的 `cmd & cmd`：单个 `&` 也是命令边界；`2>&1`、`&>file` 里的 `&` 属于重定向。
    // PowerShell 的 `&` 是调用符（`& .\x.ps1`），不拆
    const background =
      ch === "&" && !powershell && command[i - 1] !== ">" && command[i + 1] !== ">";
    if (ch === "|" || ch === ";" || ch === "\n" || ch === "\r" || background) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * 去掉引号内的内容，便于查找重定向等特征（引号里的 `>` 不算）。
 * keepDouble 为 true 时保留双引号里的内容：两种 shell 都会在双引号里展开 `$(…)`（bash 还有反引号），
 * 查命令替换时只能去掉单引号里的字面文本。
 */
function unquoted(segment: string, keepDouble = false, powershell = false): string {
  let out = "";
  let quote: string | null = null;
  const esc = powershell ? "`" : "\\";
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i] as string;
    // 转义的字符是字面量（\> 不是重定向，\" 不结束引号）：引号外换成占位；双引号里按 keepDouble 保留
    if (ch === esc && quote !== "'" && i + 1 < segment.length) {
      if (!quote) out += "_";
      else if (keepDouble) out += ch + segment[i + 1];
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        out += ch;
      } else if (quote === '"' && keepDouble) out += ch;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    out += ch;
  }
  return out;
}

/**
 * 按 shell 规则拆词：空白与 | ; & < > ( ) 分词，引号与相邻文字拼成一个词（"/opt/A B"/data → /opt/A B/data），
 * 去掉引号与转义符（bash 的 \，PowerShell 的 `）。expands 表示词里有引号外或双引号里的 $（会展开变量）。
 * 引号没闭合返回 undefined
 */
export function shellWords(
  command: string,
  powershell: boolean,
): { word: string; expands: boolean }[] | undefined {
  const esc = powershell ? "`" : "\\";
  const out: { word: string; expands: boolean }[] = [];
  let word = "";
  let expands = false;
  let started = false;
  const flush = () => {
    if (started) out.push({ word, expands });
    word = "";
    expands = false;
    started = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command.charAt(i);
    if (c === esc && i + 1 < command.length) {
      if (command[i + 1] !== "\n") word += command[i + 1];
      started = true;
      i++;
    } else if (c === "'") {
      const j = command.indexOf("'", i + 1);
      if (j < 0) return undefined;
      word += command.slice(i + 1, j);
      started = true;
      i = j;
    } else if (c === '"') {
      started = true;
      let j = i + 1;
      for (; j < command.length && command[j] !== '"'; j++) {
        if (command[j] === esc && j + 1 < command.length) {
          j++;
          // 转义的换行是续行：反斜杠与换行一起去掉（".en\<换行>v" 就是 .env）
          if (command[j] === "\n") continue;
        }
        if (command[j] === "$") expands = true;
        word += command[j];
      }
      if (j >= command.length) return undefined;
      i = j;
    } else if (/[\s|;&<>()]/.test(c)) flush();
    else {
      if (c === "$") expands = true;
      word += c;
      started = true;
    }
  }
  flush();
  return out;
}

/** 命令名规范化：去掉路径、`.exe` 等扩展名、PowerShell 的调用符 `&` */
function commandName(word: string): string {
  const base = word.replace(/^&/, "").split(/[\\/]/).pop() ?? word;
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

/**
 * PowerShell 的变量赋值（`$x = …`、`$env:PATH += …`、`${function:ls} = {…}`、`$a.b = …`）：
 * 能改环境变量、换掉命令（function: / alias: 驱动器）或改对象属性，判断不了
 */
const PS_ASSIGNMENT =
  /(^|[\s;{(|])\$(\{[^}]*\}|[\w:]+)(\.[\w]+|\[[^\]]*\])*\s*[-+*/%?]?\?{0,1}=(?!=)/;

function classifySegment(segment: string, powershell: boolean): CommandClass {
  const bare = unquoted(segment, false, powershell);
  if (powershell && PS_ASSIGNMENT.test(bare)) return "unknown";
  // 写文件的重定向：`>`、`>>`、`&>`，含紧贴参数的 `echo hi>out.txt`；
  // 只允许把输出丢弃或合并（2>$null、2>/dev/null、2>&1、>$null、>NUL）
  for (const m of bare.matchAll(/>>?\s*(&\d|[^\s|;&<>]*)/g)) {
    const target = (m[1] ?? "").toLowerCase();
    if (!["$null", "/dev/null", "nul", "&1", "&2"].includes(target)) return "write";
  }
  // 命令替换、脚本块执行、编码命令：内容判断不了
  // （PowerShell 的反引号是转义符，bash 的反引号是命令替换）
  const expanded = unquoted(segment, true, powershell);
  if (/\$\(|<\(/.test(expanded) || (!powershell && expanded.includes("`"))) return "unknown";
  if (/(^|[\s;|&(])(iex|invoke-expression|invoke-command|icm)\b/i.test(bare)) return "unknown";

  // bash 的 ANSI-C 引号（$'\x2du'）能拼出任意参数，还原不了
  if (!powershell && bare.includes("$'")) return "unknown";
  // PowerShell 的括号表达式在参数求值时就执行：Get-Content (Remove-Item a)、ls @(…)。
  // 脚本块外有括号就判断不了（块内的括号在 classifyPsBlock 里判断）
  if (powershell && stripBlocks(bare).includes("(")) return "unknown";
  // 按 shell 规则拆词（去掉引号与转义符，'--hidden'、-\u 还原成真正的参数）；引号没闭合判断不了
  const parsed = shellWords(segment, powershell);
  if (!parsed) return "unknown";
  const ws = parsed.map((w) => w.word);
  const first = ws[0];
  if (first === undefined) return "readonly";
  // bash 的环境变量赋值：单独出现是改 shell 状态；作为前缀（PATH=… ls、LD_PRELOAD=…、GIT_PAGER=…）
  // 能换掉实际执行的程序或让只读命令执行别的程序，判断不了
  if (!powershell && /^[A-Za-z_][A-Za-z0-9_]*=/.test(first))
    return ws.length > 1 ? "unknown" : "write";
  // 带路径的命令（./ls、C:\tools\git.exe）：实际执行的是哪个程序判断不了
  if (/[\\/]/.test(first.replace(/^&/, ""))) return "unknown";
  const name = commandName(first);
  const args = ws.slice(1);
  const hasArg = (re: RegExp) => args.some((a) => re.test(a));
  const sub = args.find((a) => !a.startsWith("-"))?.toLowerCase();

  if (WRITE_COMMANDS.has(name)) return "write";
  // PowerShell 脚本块里可以是任意代码。sort、where、echo、cat、ls 等在 PowerShell 里都是 cmdlet 的别名，
  // 不能先按通用白名单放行：只要段里有脚本块，先在这里判断
  if (powershell && unquoted(segment, false, powershell).includes("{"))
    return classifyPsBlock(segment, name);
  // 嵌套的 shell（bash -c、powershell -Command、cmd /c 等）：内容判断不了
  if (["bash", "sh", "zsh", "powershell", "pwsh", "cmd", "wsl"].includes(name)) return "unknown";
  if (name === "git") {
    // `git -c core.pager=… log` 之类的临时配置可以让只读子命令执行任意程序
    if (args.includes("-c") || hasArg(/^--config-env/)) return "unknown";
    // 只读子命令也能把结果写进文件（git diff --output=x、git log -o x 不存在但 --output 通用）
    if (hasArg(/^--output(=|$)/)) return "write";
    // 子命令前的全局选项只认这几个；--exec-path 等能换掉实际执行的程序，判断不了
    let i = 0;
    while (i < args.length && (args[i] as string).startsWith("-")) {
      const a = args[i] as string;
      if (a === "-C" || a === "--git-dir" || a === "--work-tree") i += 2;
      else if (/^--(git-dir|work-tree)=/.test(a) || GIT_GLOBAL_FLAGS.has(a)) i += 1;
      else return "unknown";
    }
    const gsub = args[i]?.toLowerCase();
    if (gsub === undefined) return "readonly";
    if (GIT_WRITE.has(gsub)) return "write";
    const rest = args.slice(i + 1);
    // 只读子命令里会调用外部程序的选项：git grep -O / --open-files-in-pager（在分页器里打开），
    // 外部 diff（--ext-diff）、文本转换与过滤器（--textconv、--filters），git help 打开浏览器 / man / info
    if (gsub === "grep" && rest.some((a) => /^--open-files-in-pager|^-[a-zA-Z]*O/.test(a)))
      return "unknown";
    // --show-signature 调用 gpg.program 验签
    if (rest.some((a) => /^--(ext-diff|textconv|filters|show-signature)$/.test(a)))
      return "unknown";
    if (gsub === "help" && rest.some((a) => a.startsWith("-"))) return "unknown";
    if (gsub === "branch" || gsub === "remote") {
      const listing = rest.every((a) =>
        ["-a", "-r", "-v", "-vv", "--list", "-l", "--show-current", "--all"].includes(a),
      );
      return listing ? "readonly" : "write";
    }
    if (gsub === "config") {
      return rest.some((a) => ["--get", "--list", "-l", "--get-all"].includes(a))
        ? "readonly"
        : "unknown";
    }
    return GIT_READONLY.has(gsub) ? "readonly" : "unknown";
  }
  if (PKG_MANAGERS.has(name)) {
    if (sub === undefined) return args.length ? "readonly" : "unknown";
    if (PKG_WRITE.has(sub)) return "write";
    // npm / pnpm / yarn audit fix、--fix：会改依赖与锁文件
    if (sub === "audit" && args.some((a) => /^(fix|--fix)$/i.test(a))) return "write";
    return PKG_READONLY.has(sub) || args.includes("--version") ? "readonly" : "unknown";
  }
  if (name === "node" || name === "python" || name === "python3" || name === "rustc") {
    return args.length === 1 && /^(-v|--version|-V)$/.test(args[0] as string)
      ? "readonly"
      : "unknown";
  }
  if (name === "sed") {
    if (args.some((a) => /^-i|^--in-place/.test(a))) return "write";
    // sed 脚本里的 w / W 命令、s///w 写文件，e 命令、s///e 执行命令；脚本文件（-f）内容看不到
    if (hasArg(/^(-f|--file)/)) return "unknown";
    const script = /(^|[;\n{}!\d$\s/])\s*[wWe](\s|$|;)|\/[gpIiMm\d]*[we]\b/;
    // 脚本可以是单独的参数、`-e 脚本`、`--expression=脚本`，也可以紧贴短选项（`-e'w out'`、`-ne'…'`），
    // 引号里还可能有空格：不按参数拆，直接在命令名之后的整段文字（引号换成空格）里找
    const text = segment
      .replace(/^\s*\S+/, "")
      .replace(/['"]|--expression=|(^|\s)-[a-zA-Z]*e/g, " ");
    return script.test(text) ? "unknown" : "readonly";
  }
  if (name === "find") {
    return args.some((a) =>
      [
        "-delete",
        "-exec",
        "-execdir",
        "-ok",
        "-okdir",
        "-fprint",
        "-fprint0",
        "-fprintf",
        "-fls",
      ].includes(a),
    )
      ? "unknown"
      : "readonly";
  }
  // 白名单命令里会写文件或执行其他程序的参数
  if (name === "env" && args.length > 0) return "unknown"; // env cmd … 会执行 cmd
  if (name === "sort" && hasArg(/^(-o|--output)/)) return "write";
  // sort --compress-program=PROG 用 PROG 压缩临时文件（会执行它）
  if (name === "sort" && hasArg(/^--compress-prog/)) return "unknown";
  if (name === "tree" && hasArg(/^(-o|-R)$/)) return "write";
  if (name === "uniq" && args.filter((a) => !a.startsWith("-")).length > 1) return "write"; // uniq in out
  if (name === "date" && hasArg(/^(-s|--set)/)) return "write";
  if (name === "file" && hasArg(/^(-C|--compile)$/)) return "write";
  if (name === "hostname" && args.some((a) => !a.startsWith("-"))) return "write";
  if (name === "rg" && hasArg(/^--pre(=|$)/)) return "unknown";
  if (name === "fd" && hasArg(/^(-x|-X|--exec|--exec-batch)(=|$)/)) return "unknown";
  if (COMMON_READONLY.has(name)) return "readonly";
  if (powershell && PS_READONLY.has(name)) return "readonly";
  // 变量读取（$x、$PSVersionTable）
  if (powershell && /^\$[\w:]+$/.test(first) && args.length === 0) return "readonly";
  return "unknown";
}

/** 去掉 PowerShell 脚本块 `{ … }`（含嵌套）的内容 */
function stripBlocks(text: string): string {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

/** 能执行脚本块的过滤 / 遍历 cmdlet（含别名）：块内再判断一次；其他命令带脚本块判断不了 */
const PS_BLOCK_CMDLETS = new Set(["foreach-object", "foreach", "%", "where-object", "where", "?"]);

function classifyPsBlock(segment: string, name: string): CommandClass {
  const bare = unquoted(segment, false, true);
  if (!PS_BLOCK_CMDLETS.has(name)) return "unknown";
  const open = bare.indexOf("{");
  const close = bare.lastIndexOf("}");
  if (close < open) return "unknown";
  const block = bare.slice(open + 1, close);
  // 嵌套脚本块、调用符 & 与点调用 . { }、静态方法 [IO.File]::Delete()、对象方法 $_.Delete()、
  // 括号里调用命令 (Remove-Item a)：都判断不了
  if (/[{}]|&|::|(^|[\s;(])\.\s|\.\w+\s*\(|\(\s*[A-Za-z]/.test(block)) return "unknown";
  // 块外只能有参数（-FilterScript、-Process 等）
  let inner: CommandClass = "readonly";
  for (const seg of splitSegments(block, true)) {
    if (PS_ASSIGNMENT.test(seg) || seg.startsWith("(")) return "unknown";
    // 以 $、引号、数字开头的段是表达式（$_.Length -gt 1000），不是命令；其余段按命令判断
    if (/^[$'"\d!]/.test(seg)) continue;
    const c = classifySegment(seg, true);
    if (c === "write") return "write";
    if (c === "unknown") inner = "unknown";
  }
  return inner;
}

/** 判断一条命令；`powershell` 为 true 时按 PowerShell 语法（Windows 默认的命令工具） */
export function classifyCommand(command: string, powershell = false): CommandClass {
  const segments = splitSegments(command, powershell);
  let result: CommandClass = "readonly";
  for (const s of segments) {
    const c = classifySegment(s, powershell);
    if (c === "write") return "write";
    if (c === "unknown") result = "unknown";
  }
  return result;
}
