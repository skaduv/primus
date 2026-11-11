// 扩展 → 前端的 primus:* 数据（第 6.6 节、附录 A）：setWidget("primus:<主题>", [JSON.stringify(PrimusData)])。

/** 上下文清单的数据主题（primus-context-stats，前端发 `/primus-context-stats` 后推送） */
export const CONTEXT_STATS_WIDGET = "primus:context-stats";
export const CONTEXT_STATS_COMMAND = "primus-context-stats";

/**
 * 上下文里已加载的内容分组。只列名称，不给 token 数：Core 不提供分项 token 统计，
 * 上下文的 token 数只以 Core 的 contextUsage 为准（不估算）
 */
export type ContextStatsGroupKey = "systemTools" | "mcpTools" | "skills" | "memoryFiles";

export interface ContextStatsGroup {
  key: ContextStatsGroupKey;
  /** 工具名、技能名或记忆文件路径，按名称排序 */
  items: string[];
}

/** 本会话实际调用过的一个工具 */
export interface ContextStatsUsedTool {
  name: string;
  /** 调用次数（当前分支的 assistant 消息里 toolCall 的个数） */
  count: number;
}

/** `primus:context-stats` 的 data：只读清单，不改动上下文，不含任何估算值 */
export interface ContextStatsData {
  /** 已声明给模型的工具、系统提示词里列出的技能与记忆文件（名称） */
  groups: ContextStatsGroup[];
  /**
   * 本会话（当前分支）实际调用过的工具，按次数从多到少。未启用、未调用的工具（延迟加载 / 只供代码模式 / 关闭）
   * 不列出：它们不在上下文里
   */
  usedTools: ContextStatsUsedTool[];
}

// ---------- primus-preview：AI 在右栏打开预览（附录 A） ----------

/** 预览工具名（primus-preview 注册的自定义工具） */
export const PREVIEW_TOOL = "preview";
/** 让前端在该会话的右栏打开预览的数据主题 */
export const PREVIEW_WIDGET = "primus:preview";

/**
 * 预览的内容类别（按扩展名，与右栏 file-preview.tsx 的渲染方式对应）：
 * folder 文件夹；text 等宽原样显示的文本；markdown 渲染后的 Markdown；image 图片（含 SVG）；
 * html 沙箱里渲染的网页；document Word / PowerPoint / PDF；spreadsheet Excel / CSV / TSV 表格；
 * media 音频 / 视频；other 没有内置预览的文件（右栏只给“用默认程序打开”）
 */
export type PreviewKind =
  | "folder"
  | "text"
  | "markdown"
  | "image"
  | "html"
  | "document"
  | "spreadsheet"
  | "media"
  | "other";

/**
 * 预览工具的结果状态：
 * shown 已在右栏打开；unsupported 文件存在但没有内置预览，右栏已打开、只显示“用默认程序打开”；
 * not_found 路径不存在；denied 被拒绝（受保护路径、网址、网络 / 设备路径、格式不正确、无权访问）；
 * too_large 超过预览上限，没有打开；no_ui 没有可显示预览的界面（例如没有桌面前端），没有打开
 */
export type PreviewStatus =
  | "shown"
  | "unsupported"
  | "not_found"
  | "denied"
  | "too_large"
  | "no_ui";

/** 预览上限（与薄壳 preview.rs / attachments.rs 一致） */
export const PREVIEW_TEXT_MAX_BYTES = 1024 * 1024;
export const PREVIEW_DOCUMENT_MAX_BYTES = 30 * 1024 * 1024;
export const PREVIEW_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const PREVIEW_MEDIA_MAX_BYTES = 64 * 1024 * 1024;

/** 预览工具结果的 details（同时给前端与程序化调用方） */
export interface PreviewToolDetails {
  status: PreviewStatus;
  /** 模型传入的原始路径 */
  input: string;
  /** 解析后的绝对路径（格式不正确时没有） */
  path?: string;
  /** 内容类别（路径存在时） */
  kind?: PreviewKind;
  /** 文件大小（字节；文件夹没有） */
  size?: number;
  /** too_large 时适用的上限（字节） */
  limit?: number;
  /** 文本类文件超过 1 MiB：右栏只显示开头 */
  truncated?: boolean;
  /** denied / not_found 等的具体原因（给模型看） */
  reason?: string;
}

/** `primus:preview` 的 data：在该会话所在标签的右栏打开 path */
export interface PreviewData {
  /** 每次请求唯一（工具调用 ID）：同一路径再次预览也重新打开 */
  id: string;
  /** 绝对路径 */
  path: string;
  kind: PreviewKind;
}

const PREVIEW_EXT: Record<Exclude<PreviewKind, "folder" | "text" | "other">, readonly string[]> = {
  markdown: ["md", "markdown", "mdx"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"],
  html: ["html", "htm", "xhtml"],
  document: ["docx", "pptx", "pdf"],
  spreadsheet: ["xlsx", "xlsm", "csv", "tsv"],
  media: [
    "mp3",
    "wav",
    "ogg",
    "oga",
    "m4a",
    "aac",
    "flac",
    "opus",
    "mp4",
    "webm",
    "ogv",
    "mov",
    "m4v",
  ],
};

/** 没有内置预览的已知二进制格式（旧版 Office、压缩包、可执行文件等）：不必读内容就归为 other */
const OTHER_EXT = new Set([
  "doc",
  "ppt",
  "xls",
  "zip",
  "7z",
  "rar",
  "gz",
  "tar",
  "exe",
  "dll",
  "msi",
  "iso",
  "bin",
]);

/**
 * 按文件名的扩展名判断预览类别（不区分大小写）。没有对应渲染方式的扩展名返回 text：
 * 是否真是文本由调用方按内容判断（含 NUL 等二进制内容时改为 other）
 */
export function previewKindOf(path: string): Exclude<PreviewKind, "folder"> {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  for (const [kind, exts] of Object.entries(PREVIEW_EXT))
    if (exts.includes(ext)) return kind as Exclude<PreviewKind, "folder">;
  return OTHER_EXT.has(ext) ? "other" : "text";
}

// ---------- primus-plan：计划模式与待办（技术方案第 14.2、14.3 节） ----------

/** 计划模式的扩展命令：`/primus-plan on|off|status|approve <JSON>|revise <JSON>` */
export const PLAN_COMMAND = "primus-plan";
export const PLAN_WIDGET = "primus:plan";
export const TODO_WIDGET = "primus:todo";
/** 提交计划等待审批的工具 */
export const PLAN_SUBMIT_TOOL = "plan_submit";
/** 维护待办清单的工具 */
export const TODO_TOOL = "todo";
/** 向用户提选择题的工具 */
export const ASK_USER_TOOL = "ask_user";

/**
 * 计划模式的阶段：
 *   off        普通模式
 *   planning   计划中（只读，guard 拦截修改）
 *   awaiting   已提交计划，等待用户审批（plan_submit 阻塞中）
 *   executing  已批准，按计划执行（待办未完成）
 */
export type PlanPhase = "off" | "planning" | "awaiting" | "executing";

export interface PlanStep {
  id: string;
  title: string;
  detail?: string;
  /** 涉及的文件（相对工作区或绝对路径） */
  files?: string[];
}

/** plan_submit 的参数，也是审批卡片显示的计划（每次提交完整替换上一版） */
export interface PlanDoc {
  title: string;
  /** 背景、目标与成功标准 */
  summary: string;
  steps: PlanStep[];
  risks?: string[];
  verification: string[];
  assumptions?: string[];
}

/** 批准后执行时的权限模式：自动编辑、每次询问，或保持当前模式 */
export type PlanApprovePermission = "edit" | "ask" | "keep";

/** `/primus-plan approve <JSON>` 的参数 */
export interface PlanApproveArgs {
  id: string;
  /** 用户在卡片上改过的计划（缺省表示按原计划） */
  plan?: PlanDoc;
  permission?: PlanApprovePermission;
}

/** `/primus-plan revise <JSON>` 的参数：不执行，带反馈继续完善 */
export interface PlanReviseArgs {
  id: string;
  feedback: string;
}

/** 一次提交的计划在界面上的状态 */
export type PlanStatus = "awaiting" | "approved" | "revising" | "cancelled";

/** `primus:plan` 的 data：当前阶段与最近一次提交的计划 */
export interface PlanData {
  phase: PlanPhase;
  /** 最近一次提交（p1、p2…）；还没提交过时缺省 */
  id?: string;
  status?: PlanStatus;
  plan?: PlanDoc;
  /** 计划 Markdown 文件的绝对路径 */
  path?: string;
}

/** plan_submit 工具结果的 details：卡片据此显示计划与结局 */
export interface PlanSubmitDetails {
  id: string;
  status: PlanStatus | "invalid" | "no_ui" | "not_planning";
  plan?: PlanDoc;
  /** 用户编辑过计划 */
  edited?: boolean;
  feedback?: string;
  path?: string;
}

export type TodoStatus = "pending" | "in_progress" | "completed" | "skipped";

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
}

/** `primus:todo` 的 data：完整的待办清单（每次整体替换；空数组表示没有待办） */
export interface TodoData {
  items: TodoItem[];
}

const PLAN_PHASES: readonly PlanPhase[] = ["off", "planning", "awaiting", "executing"];
const TODO_STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed", "skipped"];

export const isPlanPhase = (v: unknown): v is PlanPhase =>
  typeof v === "string" && (PLAN_PHASES as readonly string[]).includes(v);
export const isTodoStatus = (v: unknown): v is TodoStatus =>
  typeof v === "string" && (TODO_STATUSES as readonly string[]).includes(v);

/** 校验待办项（来自工具参数或 primus:todo），不合法的项丢弃 */
export function normalizeTodoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];
  const items: TodoItem[] = [];
  for (const raw of value) {
    const it = raw as Partial<TodoItem> | null;
    if (!it || typeof it.text !== "string" || !it.text.trim()) continue;
    items.push({
      id: typeof it.id === "string" && it.id ? it.id : String(items.length + 1),
      text: it.text.trim(),
      status: isTodoStatus(it.status) ? it.status : "pending",
    });
  }
  return items;
}

/**
 * 唇条显示的“当前步骤”：进行中的那一项；没有进行中的取第一项未完成的；全部完成或跳过时为 undefined
 */
export function currentTodo(items: readonly TodoItem[]): TodoItem | undefined {
  return items.find((i) => i.status === "in_progress") ?? items.find((i) => i.status === "pending");
}

/** 计划渲染成 Markdown（计划文件、批准后发给模型的计划正文） */
export function planToMarkdown(plan: PlanDoc): string {
  const list = (items: readonly string[] | undefined) =>
    (items ?? []).filter((s) => s.trim()).map((s) => `- ${s.trim()}`);
  const out = [`# ${plan.title.trim()}`, "", plan.summary.trim(), "", "## 步骤", ""];
  plan.steps.forEach((s, i) => {
    out.push(`${i + 1}. **${s.title.trim()}**`);
    if (s.files?.length) out.push(`   - 文件：${s.files.map((f) => `\`${f}\``).join("、")}`);
    if (s.detail?.trim())
      for (const line of s.detail.trim().split("\n")) out.push(`   ${line}`.trimEnd());
  });
  const section = (title: string, items: readonly string[] | undefined) => {
    const lines = list(items);
    if (lines.length) out.push("", `## ${title}`, "", ...lines);
  };
  section("风险", plan.risks);
  section("验证", plan.verification);
  section("假设", plan.assumptions);
  return `${out.join("\n")}\n`;
}
