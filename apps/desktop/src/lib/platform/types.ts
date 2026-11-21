import type { CoreBatch, RpcCommand, WebSettings } from "@primus/protocol";

// 平台接口（附录 B 薄壳命令）。前端只依赖这里的类型，不直接依赖 Tauri。
// 返回值中细节尚未定稿的字段先用宽松类型，随对应模块落地再收紧。

export interface AppInfo {
  appVersion: string;
  coreVersion: string;
  dataDir: string;
  platform: string;
  /** 运行环境：真实薄壳或浏览器预览用的 mock */
  runtime: "tauri" | "mock";
}

export interface WorkspaceInfo {
  path: string;
  name: string;
  /** 当前有效的信任状态：已信任且 `.primus/` 未变化 */
  trusted: boolean;
  /** 需要显示信任确认：从未确认过，或信任后 `.primus/` 已变化（第 17.2 节） */
  needsTrust: boolean;
}

/** 信任确认展示的项目内容（`workspace_inspect`，第 17.2 节） */
export interface TrustDetails {
  path: string;
  /** 根目录 AGENTS.md 的内容；不存在为 null */
  agentsMd: string | null;
  agentsMdTruncated: boolean;
  extensions: string[];
  skills: string[];
  /** `.primus/mcp.json` 中的服务器名；文件无法解析或过大时为 `["mcp.json"]` */
  mcpServers: string[];
  /**
   * 工作区本级 `.agents/mcp.json` 中的服务器名（不往上级找，与 Core 一致，ADR 0022）；
   * 文件无法解析或过大时为 `["mcp.json"]`
   */
  agentsMcpServers: string[];
  /**
   * 工作区及上级目录（到 Git 仓库根为止）`.agents/skills` 中信任后 Core 会加载的技能，
   * 带相对工作区的目录前缀（如 `.agents/skills/review`、`../.agents/skills/lint`）
   */
  agentsSkills: string[];
}

/** 会话索引中的一条会话（`session_list` / `session_search`，第 10.2 节、ADR 0006） */
export interface SessionSummary {
  /** 会话文件绝对路径：打开、删除、归档都用它 */
  path: string;
  id: string;
  /** 会话名；没有时显示 `title` */
  name: string | null;
  /** 首条用户消息（截断）；还没有用户消息时为空串 */
  title: string;
  /** 所属工作区（会话文件头的 cwd） */
  workspace: string;
  /** 创建时间（毫秒） */
  createdAt: number;
  /** 最后活动时间（毫秒） */
  updatedAt: number;
  messageCount: number;
  archived: boolean;
}

/** 会话索引变化的信号（`session_watch`）：`seq` 递增，收到后重新拉取列表 */
export interface SessionIndexEvent {
  seq: number;
}

/**
 * 通知与提示音设置（ADR 0023）：`users/<SID>/app/notifications.json`。
 * - `turnComplete`：一轮结束（完成或出错）时：从不 / 只在后台时 / 始终。用户自己停止的不提醒
 * - `needsInput`：需要用户确认、选择、回答或批准计划时提醒（只在后台时）
 * - `sound`：提醒时播放提示音
 * “后台”：窗口不在前台，或这个会话不是当前显示的会话
 */
export type TurnCompleteNotify = "never" | "background" | "always";

export interface NotificationSettings {
  turnComplete: TurnCompleteNotify;
  needsInput: boolean;
  sound: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  turnComplete: "background",
  needsInput: true,
  sound: true,
};

/** 一条系统通知（`notification_show`） */
export interface NotificationRequest {
  title: string;
  body: string;
  /** 点击通知时原样交回 `notificationWatch` 的回调（前端用标签 ID，点开后切到这个会话） */
  tag: string;
  /** 需要用户处理：窗口不在前台时同时闪烁任务栏按钮 */
  attention: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface SessionHandle {
  sessionKey: string;
  /** 新会话的会话 ID（与 SessionSummary.id 对应）；恢复已有会话时为 null */
  sessionId?: string | null;
}

/** 用量统计中的单条成本信息（`usage_stats`） */
export interface UsageCost {
  amount: number;
  currency: string;
  estimated: boolean;
}

/** 用量统计中的单次模型调用记录（`usage_stats`） */
export interface UsageCall {
  id: string;
  timestamp: number;
  model: string;
  input: number | null;
  output: number | null;
  total: number | null;
  cost: UsageCost | null;
  status: "success" | "failed" | "cancelled";
  session?: Pick<SessionSummary, "path" | "id" | "workspace">;
}

/** 近 12 个月本地会话的用量统计汇总（`usage_stats`） */
export interface UsageStats {
  calls: UsageCall[];
  completedAt: number[];
}

export type BatchListener = (batch: CoreBatch) => void;

/** 账号信息（第 9.7 节）；账号服务接入后提供 */
export interface AccountInfo {
  id: string;
  name: string;
  kind: "service";
}

/** `auth_status` 的返回值；账号服务接入前恒为未登录、不可登录 */
export interface AuthStatus {
  loggedIn: boolean;
  account: AccountInfo | null;
  /** 是否可以发起登录 / 登出；账号服务接入前为 false */
  loginAvailable: boolean;
}

/** 模型端点协议（约束 C1：只有这两种） */
export type ProviderApi = "openai-responses" | "anthropic-messages";

/** 可选模型（第 9.5 节下拉框显示的字段）；`key` 为 `<渠道 ID>/<模型 ID>`，`provider` 为渠道 ID */
export interface ModelSummary {
  key: string;
  provider: string;
  id: string;
  name: string;
  api: ProviderApi;
  reasoning: boolean;
  image: boolean;
  contextWindow: number;
  maxTokens: number;
}

/**
 * 渠道下的一个模型（`provider_save` 的 `models` 项，也是 `provider_fetch_models` 的返回项）。
 * 薄壳严格校验字段：不得带多余字段
 */
export interface ProviderModel {
  id: string;
  name: string;
  reasoning: boolean;
  /** 必须含 `text`；支持图片时再含 `image` */
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
}

/** 模型渠道（`providers_list`）；密钥不会返回，只有是否已保存与末 4 位 */
export interface ProviderView {
  id: string;
  name: string;
  api: ProviderApi;
  baseUrl: string;
  enabled: boolean;
  models: ProviderModel[];
  hasKey: boolean;
  /** 密钥末 4 位；没有密钥或密钥太短时为 null */
  keyHint: string | null;
  /** 未被修改且启用的内置渠道：不显示在设置页的渠道管理中，但仍参与模型配置与模型选择 */
  hidden: boolean;
}

/** `provider_save` 的参数：无 `id` 为新建（必须带 `apiKey`）；有 `id` 为修改，`apiKey` 缺省保留已存密钥 */
export interface ProviderSaveInput {
  id?: string;
  name: string;
  api: ProviderApi;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
  models: ProviderModel[];
}

/** `provider_fetch_models` 的参数：有 `id` 时用已保存的渠道，提供的字段覆盖之；无 `id` 时三项必填 */
export interface ProviderFetchInput {
  id?: string;
  api?: ProviderApi;
  baseUrl?: string;
  apiKey?: string;
}

/** `provider_save` / `provider_delete` 的返回值 */
export interface ProvidersChanged {
  providers: ProviderView[];
  models: ModelsInfo;
}

/** `models_get` / `models_refresh` / `models_set_default` 的返回值 */
export interface ModelsInfo {
  version: number | null;
  models: ModelSummary[];
  defaultModel: string | null;
  compactionModel: string | null;
  titleModel: string | null;
  /** 模型配置未能生效的原因；null 表示可以对话 */
  error: string | null;
}

export interface FsEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
}

export type LogLevel = "debug" | "info" | "warn" | "error";

/** 更新通道（第 18 章“更新”分组） */
export type UpdateChannel = "stable" | "beta";

/** 更新设置（`users/<SID>/app/update.json`）：自动更新默认开、稳定版 */
export interface UpdateSettings {
  autoUpdate: boolean;
  channel: UpdateChannel;
}

export type UpdatePhase = "idle" | "checking" | "downloading" | "installing";

/** `update_status` 的返回值，也是 `update_watch` 推送的内容（第 3.6 节、ADR 0007） */
export interface UpdateStatus {
  currentVersion: string;
  /** 是否可以自动更新：发布构建编译进了更新公钥、Windows、架构受支持 */
  available: boolean;
  settings: UpdateSettings;
  phase: UpdatePhase;
  /** 下载进度（字节）；不在下载时为 null */
  progress: { downloaded: number; total: number | null } | null;
  /** 已下载并校验、等待安装的版本 */
  pending: { version: string; notes: string | null } | null;
  /** 上次检查完成的时间（毫秒） */
  lastCheck: number | null;
  /** 上次检查或下载失败的原因；自动检查失败不弹提示，只在设置页显示 */
  lastError: string | null;
}

/** 工作区所在 Git 仓库的当前分支（`git_branch`）；分离 HEAD 时 `name` 为短 SHA */
export interface GitBranch {
  name: string;
  detached: boolean;
}

/** 输入框图片附件（`attachment_image`）：在内存中缩小并编码，不写任何文件（约束 C2） */
export interface AttachmentImage {
  /** `image/png` 或 `image/jpeg` */
  mimeType: string;
  /** 缩小后图片的 base64（不含 data: 前缀），直接放进 prompt 的 `images` */
  data: string;
  /** 缩略图 data URL（短边约 112px），只用于图块显示 */
  thumb: string;
  width: number;
  height: number;
}

/**
 * 语音转文字事件（`speech_start` 的 Channel）。`interim` 为当前这一句的临时文本（随时替换，空串表示清掉），
 * `final` 为定稿；`error` 的文案固定为“语音转文字暂不可用”。
 * `level`（0–1）只有浏览器预览的 mock 会推送，真实薄壳的音量由前端 getUserMedia 计算
 */
export type SpeechEvent =
  | { type: "interim"; text: string }
  | { type: "final"; text: string }
  | { type: "level"; level: number }
  | { type: "error"; message: string }
  | { type: "end" };

export interface Platform {
  appInfo(): Promise<AppInfo>;

  workspaceOpen(path: string): Promise<WorkspaceInfo>;
  workspaceList(): Promise<WorkspaceInfo[]>;
  /** 信任确认要展示的 AGENTS.md 与 `.primus/` 下的扩展、技能、MCP 配置 */
  workspaceInspect(path: string): Promise<TrustDetails>;
  /**
   * 记录信任确认的选择（“信任”或“不信任”都算已确认）。只在首次添加工作区时确认一次，
   * 之后项目里的改动沿用信任，每次新会话由 Core 重新加载
   */
  workspaceTrust(path: string, trusted: boolean): Promise<void>;

  /** 系统文件夹对话框；取消时返回 null */
  dialogPickFolder(): Promise<string | null>;
  /** 系统文件对话框（可多选）；只返回本地路径，文件不复制 */
  dialogPickFiles(): Promise<string[]>;
  /**
   * 把对话内生成的图片（数据目录 `users/<SID>/images` 内，ADR 0018）经系统“另存为”对话框复制到用户选的位置。
   * 取消时返回 null，成功返回保存的路径；不是生成的图片或图片已删除时报错（错误文案可直接显示）
   */
  imageSave(path: string): Promise<string | null>;

  /** 联网设置（ADR 0020）：是否允许 AI 联网搜索与读取网页；没有设置时为默认（开启） */
  webSettingsGet(): Promise<WebSettings>;
  /** 修改联网设置；下一轮对话开始时生效，不需要重启内核 */
  webSettingsSet(enabled: boolean): Promise<WebSettings>;

  /** 通知与提示音设置（ADR 0023）；没有设置时为默认值 */
  notificationSettingsGet(): Promise<NotificationSettings>;
  /** 保存通知与提示音设置（整份），返回保存后的值 */
  notificationSettingsSet(settings: NotificationSettings): Promise<NotificationSettings>;
  /** 发送一条系统通知（Windows Toast，自身不带声音：提示音由前端播放）；系统不支持时静默忽略 */
  notificationShow(request: NotificationRequest): Promise<void>;
  /** 订阅通知点击：薄壳先把主窗口显示到前台，再把通知的 `tag` 交给回调；再次调用替换旧的订阅 */
  notificationWatch(onActivate: (tag: string) => void): Promise<void>;

  /**
   * 会话列表：最后活动时间倒序、每页 50 条、不含已归档。`workspace` 为 null 时列出全部工作区，
   * 空串为未选工作区的默认目录；`cursor` 为上一页的 `nextCursor`
   */
  /** 未选工作区时会话的默认工作目录（完整路径） */
  sessionDefaultWorkspace(): Promise<string>;
  sessionList(workspace: string | null, cursor?: string): Promise<Page<SessionSummary>>;
  /** 列出已归档会话（最后活动时间倒序，最多 200 条）；`workspace` 为 null 时列出全部工作区 */
  sessionListArchived(workspace: string | null): Promise<SessionSummary[]>;
  /** 搜索会话（含已归档，最多 50 条）；3 个字符以上匹配消息全文，更短只匹配会话名与首条消息 */
  sessionSearch(workspace: string | null, query: string): Promise<SessionSummary[]>;
  /** 订阅会话索引变化；再次调用替换旧的订阅 */
  sessionWatch(onChange: (event: SessionIndexEvent) => void): Promise<void>;
  /** 分配或启动 Core 进程；`onBatch` 接收该会话的事件批次（第 7.3 节） */
  sessionOpen(
    workspace: string,
    sessionPath: string | undefined,
    onBatch: BatchListener,
  ): Promise<SessionHandle>;
  sessionClose(sessionKey: string): Promise<void>;
  /** 永久删除会话文件（不进回收站）并删除索引；打开中的会话先结束其 Core 再删除 */
  sessionDelete(sessionPath: string): Promise<void>;
  /** 归档或取消归档（只改索引） */
  sessionArchive(sessionPath: string, archived: boolean): Promise<void>;

  /** 写入 Core 的 stdin；响应与事件经 `sessionOpen` 的批次返回 */
  coreSend(sessionKey: string, record: RpcCommand | { type: string; id: string }): Promise<void>;
  coreRestart(sessionKey: string): Promise<void>;

  settingsGet(): Promise<Record<string, unknown>>;
  settingsSet(patch: Record<string, unknown>): Promise<void>;
  /** 汇总近 12 个月的本地会话模型调用与完成任务统计 */
  usageStats(): Promise<UsageStats>;

  /** 账号状态；账号服务接入前恒为未登录 */
  authStatus(): Promise<AuthStatus>;
  /** 系统浏览器登录；账号服务接入前以 code `notAvailable` 拒绝 */
  authLogin(): Promise<AuthStatus>;
  /** 登出；账号服务接入前以 code `notAvailable` 拒绝 */
  authLogout(): Promise<void>;
  modelsGet(): Promise<ModelsInfo>;
  /** 按已保存的渠道重写模型配置（不联网） */
  modelsRefresh(): Promise<ModelsInfo>;
  /** 改选默认模型（`<渠道 ID>/<模型 ID>`），新会话生效 */
  modelsSetDefault(model: string): Promise<ModelsInfo>;
  /** 订阅模型配置变化（保存 / 删除渠道、刷新、改默认、启动后台获取成功）；再次调用替换旧的订阅 */
  modelsWatch(onChange: (info: ModelsInfo) => void): Promise<void>;
  /** 全部模型渠道 */
  providersList(): Promise<ProviderView[]>;
  /** 新建或修改渠道，保存后重写模型配置 */
  providerSave(input: ProviderSaveInput): Promise<ProvidersChanged>;
  /** 删除渠道（连同其密钥） */
  providerDelete(id: string): Promise<ProvidersChanged>;
  /** 向渠道获取模型列表（不保存）；已保存的模型保留用户改过的参数 */
  providerFetchModels(input: ProviderFetchInput): Promise<ProviderModel[]>;

  shellDetect(): Promise<unknown>;
  fsTree(workspace: string, path: string): Promise<FsEntry[]>;
  fsRead(workspace: string, path: string): Promise<string>;
  gitStatus(workspace: string): Promise<unknown>;
  gitDiff(workspace: string, path?: string): Promise<string>;
  /** 当前分支（只读）；不是 Git 仓库时为 null */
  gitBranch(workspace: string): Promise<GitBranch | null>;

  /**
   * 读取图片附件：按最长边 `maxEdge` 在内存中缩小并编码，附带缩略图。
   * 不是图片、超过 20 MB 或解码失败时拒绝（错误文案可直接显示）
   */
  attachmentImage(path: string, maxEdge: number): Promise<AttachmentImage>;

  /** 内置语音转文字是否可用（不可用时隐藏麦克风按钮） */
  speechAvailable(): Promise<boolean>;
  /**
   * 开始听写；事件经回调推送，最后一定有 `end`。再次调用先结束旧的会话。
   * 返回会话编号：音频与停止请求都要带上，旧会话（如另一个标签）的音频不会进入新会话，也停不掉新会话
   */
  speechStart(onEvent: (event: SpeechEvent) => void): Promise<number>;
  /** 麦克风音频：16 kHz、16 位、单声道、小端 PCM（以原始字节发送）；不是当前会话的丢弃 */
  speechAudio(session: number, pcm: Uint8Array): Promise<void>;
  /** 停止录音（已录的音频识别完后推送 `end`）；只停这个编号的会话 */
  speechStop(session: number): Promise<void>;

  terminalOpen(cwd: string, onData: (data: string) => void): Promise<{ terminalId: string }>;
  terminalWrite(terminalId: string, data: string): Promise<void>;
  terminalResize(terminalId: string, cols: number, rows: number): Promise<void>;
  terminalClose(terminalId: string): Promise<void>;

  openExternal(target: string): Promise<void>;
  /**
   * 用系统默认程序打开本机文件或文件夹（回复里的文件引用）。只接受已存在的绝对路径（可用 `~/`）；
   * 网址、网络路径会被拒绝（错误文案可直接显示）。可执行与脚本类文件不直接运行，改为在文件夹中显示并返回 `revealed`
   */
  openPath(path: string): Promise<OpenPathOutcome>;
  /** 在系统文件管理器中显示并选中文件或文件夹；校验同 `openPath` */
  revealPath(path: string): Promise<void>;
  /**
   * 右栏预览本机文件：校验同 `openPath`，只读，最多 1 MiB；二进制文件不返回内容（图片走 `attachmentImage`），
   * 文件夹返回 `{ kind: "directory" }`（改用 `previewDir`）
   */
  previewFile(path: string): Promise<FilePreview>;
  /**
   * 右栏按“打开后的样子”预览：读取整份文件字节（校验同 `openPath`）。只接受 Word / PowerPoint / Excel / PDF
   * （docx / pptx / xlsx / xlsm / pdf）与 GIF / ICO / AVIF 图片（最多 30 MiB），以及音频视频
   * （mp3 / wav / ogg / oga / opus / m4a / aac / flac / mp4 / m4v / webm / mov / ogv，最多 64 MiB）；
   * 超过时报错，错误文案可直接显示
   */
  previewFileBytes(path: string): Promise<ArrayBuffer>;
  /**
   * 右栏文件夹预览：列出直接子项（校验同 `openPath`，只读元数据），文件夹在前、按名称自然排序，
   * 最多 2000 项（`truncated`）；隐藏 / 系统项带 `hidden`
   */
  previewDir(path: string): Promise<DirListing>;
  /**
   * 右栏可运行的网页预览：登记文件所在文件夹（校验同 `openPath`），返回 `primus-preview` 协议下该文件的 URL。
   * 页面放进只给 `allow-scripts` 的沙箱 iframe，脚本、同文件夹的相对资源与 https 资源都能加载
   */
  previewServe(path: string): Promise<string>;
  /** 能力中心·技能（ADR 0017）：Core 用户目录 `skills/` 与 `~/.agents/skills` 中的技能 */
  skillsList(): Promise<SkillInfo[]>;
  /** 把来源（GitHub 链接 / 本地 zip / 本地文件夹）解到暂存目录，按 Core 加载 `skills/<名称>/` 的规则列出其中的全部技能 */
  skillStage(source: SkillSource): Promise<SkillStage>;
  /**
   * 把暂存的整个来源装进 `skills/<name>`，其中的技能 Core 全部按自己的规则加载；已有同名目录时以 code `exists`
   * 拒绝，用户确认后带 `overwrite` 重试。返回安装后的目录；成功后这次暂存删除
   */
  skillInstall(stageId: string, name: string, overwrite: boolean): Promise<string>;
  /** 放弃一次暂存 */
  skillDiscard(stageId: string): Promise<void>;
  /** 删除 Core 用户目录 `skills/` 里的技能（链接只删链接本身；所在顶层目录里的最后一个技能删掉时顶层目录一并删除） */
  skillDelete(file: string): Promise<void>;
  /** 启用或停用技能（写 Core 设置，新会话生效） */
  skillSetEnabled(file: string, enabled: boolean): Promise<void>;
  /** 读取用户级 mcp.json */
  mcpConfigRead(): Promise<McpConfigFile>;
  /** 写入用户级 mcp.json；文件已被别处修改时以 code `conflict` 拒绝。返回新版本 */
  mcpConfigWrite(text: string, version: string): Promise<string>;
  /** 列出 MCP 服务器并测试连接（Core `mcp list --json`，最多 60 秒） */
  mcpList(): Promise<CliOutput>;
  /** OAuth 登录（Core 打开系统浏览器，最多等 5 分钟） */
  mcpLogin(name: string): Promise<CliOutput>;
  /** 删除已保存的 OAuth 凭据 */
  mcpLogout(name: string): Promise<CliOutput>;
  storageUsage(): Promise<Record<string, number>>;
  storageClean(category: string): Promise<void>;
  diagnosticsExport(options?: Record<string, unknown>): Promise<string>;
  /** 自动更新状态 */
  updateStatus(): Promise<UpdateStatus>;
  /** 订阅更新状态（注册后立即推送一次）；再次调用替换旧的订阅 */
  updateWatch(onChange: (status: UpdateStatus) => void): Promise<void>;
  /** 立即检查；有更高版本时下载并校验，返回检查后的状态。`channel` 只用于本次检查 */
  updateCheck(channel?: UpdateChannel): Promise<UpdateStatus>;
  /** 修改更新设置（自动更新开关、通道） */
  updateSettingsSet(patch: Partial<UpdateSettings>): Promise<UpdateStatus>;
  /**
   * 立即重启并安装已下载的更新（成功时 App 退出）。有运行中的 Agent 时以 code `busy` 拒绝，
   * 用户确认后带 `force` 再调；用户取消管理员授权时以 code `cancelled` 拒绝（更新包保留）
   */
  updateInstall(force?: boolean): Promise<void>;
  logWrite(level: LogLevel, message: string): Promise<void>;
}

/** 能力中心·技能：来源目录（ADR 0017） */
export type SkillScope = "user" | "agents";

/** 已安装的技能（`skillsList`） */
export interface SkillInfo {
  /** 技能文件所在目录的名字；frontmatter 没写 name 时 Core 用它 */
  dirName: string;
  /** 技能文件（`SKILL.md` 或单个 `*.md`）的绝对路径，启停与删除都用它 */
  file: string;
  /** 技能目录 */
  dir: string;
  /** `user`：Core 用户目录 `skills/`（能力中心安装，可删除）；`agents`：`~/.agents/skills`（只能启停） */
  scope: SkillScope;
  /** 技能文件开头（最多 64 KiB），用于解析 frontmatter；读不了时为 null */
  content: string | null;
  enabled: boolean;
  /** `skills/` 里的技能，且路径中间没有经过链接 */
  deletable: boolean;
  /** 技能目录（或单文件）本身是链接 / 目录联接（删除只删链接） */
  link: boolean;
  /** 技能不是 `skills/` 的直接子项时，它所在的顶层目录名（一次安装的仓库 / 压缩包 / 文件夹）；否则为 null */
  package: string | null;
}

/** 技能的安装来源 */
export type SkillSource =
  | { kind: "github"; url: string }
  | { kind: "zip"; path: string }
  | { kind: "folder"; path: string };

/** 暂存中找到的技能（安装时一起装入） */
export interface SkillCandidate {
  /** 相对暂存根目录的路径；根目录本身是技能时为空串 */
  path: string;
  dirName: string;
  /** SKILL.md 开头（最多 64 KiB） */
  content: string;
}

/** `skillStage` 的结果 */
export interface SkillStage {
  stageId: string;
  /** 来源名（仓库名、链接里的子目录名、压缩包或文件夹名），用来建议安装目录名 */
  label: string;
  candidates: SkillCandidate[];
  /** 跳过的符号链接数 */
  skippedLinks: number;
  /** 候选过多，只列出了前 200 个 */
  truncated: boolean;
}

/** 用户级 `mcp.json`（`mcpConfigRead`） */
export interface McpConfigFile {
  path: string;
  /** 原文；文件不存在时为 null */
  text: string | null;
  /** 版本，写入时原样带回 */
  version: string;
  /** `~/.agents/mcp.json`（与其他工具共用，只读，ADR 0022）；主目录未知时为 null */
  agents?: SharedMcpFile | null;
}

/** 只读展示的 `~/.agents/mcp.json` */
export interface SharedMcpFile {
  path: string;
  /** 原文；文件不存在或读不出时为 null */
  text: string | null;
  /** 读不出的原因 */
  error: string | null;
}

/** 一次 Core 命令行调用的结果（`mcp list` / `login` / `logout`） */
export interface CliOutput {
  /** 退出码；超时被结束时为 null */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** 技能命令错误码：已有同名技能，用户确认后带 overwrite 重试 */
export const SKILL_EXISTS = "exists";
/** MCP 配置错误码：mcp.json 已在别处被修改，需重新读取 */
export const MCP_CONFLICT = "conflict";

/** `previewFile` 的结果 */
export type FilePreview =
  | { kind: "text"; text: string; truncated: boolean; size: number }
  | { kind: "binary"; size: number }
  | { kind: "directory" };

/** `previewDir` 中的一项 */
export interface DirEntry {
  name: string;
  /** 文件夹（指向文件夹的链接也算） */
  dir: boolean;
  /** 字节数；文件夹与取不到时为 null */
  size: number | null;
  /** 修改时间（Unix 毫秒）；取不到时为 null */
  modifiedMs: number | null;
  /** 隐藏或系统项（Windows 隐藏 / 系统属性；其他平台 `.` 开头） */
  hidden: boolean;
}

/** `previewDir` 的结果 */
export interface DirListing {
  entries: DirEntry[];
  /** 子项总数（扫描上限 20000，超过时为下限） */
  total: number;
  /** 只返回了一部分 */
  truncated: boolean;
}

/** `openPath` 的结果：已打开，或因是可执行 / 脚本文件改为在文件夹中显示 */
export type OpenPathOutcome = "opened" | "revealed";

/** 账号命令错误码：功能尚未开放（账号服务接入前的登录 / 登出） */
export const AUTH_NOT_AVAILABLE = "notAvailable";

/** 更新命令错误码：有正在运行的 Agent，需要用户确认后带 force 重试 */
export const UPDATE_BUSY = "busy";
/** 更新命令错误码：用户取消了管理员授权（更新包保留，下次启动再装） */
export const UPDATE_CANCELLED = "cancelled";

/** 会话命令错误码：会话的内核未运行（重启失败、因进程上限被淘汰或已自行退出），需重启内核 */
export const CORE_NOT_RUNNING = "coreNotRunning";

/** 薄壳命令返回的结构化错误（`{ code, message }`，见 core_send / core_restart）；code 供界面区分处理 */
export class PlatformError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
  }
}

/** 把命令的拒绝值转成 PlatformError：结构化错误带上 code；字符串等其他值原样返回 */
export function toPlatformError(e: unknown): unknown {
  if (typeof e === "object" && e !== null && !(e instanceof Error) && "message" in e) {
    const { message, code } = e as { message: unknown; code?: unknown };
    return new PlatformError(String(message), typeof code === "string" ? code : undefined);
  }
  return e;
}

/** Platform 方法名 → 薄壳命令名（附录 B）。tauri 实现按此表 invoke；测试用它核对覆盖面 */
export const COMMANDS = {
  appInfo: "app_info",
  workspaceOpen: "workspace_open",
  workspaceList: "workspace_list",
  workspaceInspect: "workspace_inspect",
  workspaceTrust: "workspace_trust",
  dialogPickFolder: "dialog_pick_folder",
  dialogPickFiles: "dialog_pick_files",
  imageSave: "image_save",
  webSettingsGet: "web_settings_get",
  webSettingsSet: "web_settings_set",
  notificationSettingsGet: "notification_settings_get",
  notificationSettingsSet: "notification_settings_set",
  notificationShow: "notification_show",
  notificationWatch: "notification_watch",
  sessionDefaultWorkspace: "session_default_workspace",
  sessionList: "session_list",
  sessionListArchived: "session_list_archived",
  sessionSearch: "session_search",
  sessionWatch: "session_watch",
  sessionOpen: "session_open",
  sessionClose: "session_close",
  sessionDelete: "session_delete",
  sessionArchive: "session_archive",
  coreSend: "core_send",
  coreRestart: "core_restart",
  settingsGet: "settings_get",
  settingsSet: "settings_set",
  usageStats: "usage_stats",
  authStatus: "auth_status",
  authLogin: "auth_login",
  authLogout: "auth_logout",
  modelsGet: "models_get",
  modelsRefresh: "models_refresh",
  modelsSetDefault: "models_set_default",
  modelsWatch: "models_watch",
  providersList: "providers_list",
  providerSave: "provider_save",
  providerDelete: "provider_delete",
  providerFetchModels: "provider_fetch_models",
  shellDetect: "shell_detect",
  fsTree: "fs_tree",
  fsRead: "fs_read",
  gitStatus: "git_status",
  gitDiff: "git_diff",
  gitBranch: "git_branch",
  attachmentImage: "attachment_image",
  speechAvailable: "speech_available",
  speechStart: "speech_start",
  speechAudio: "speech_audio",
  speechStop: "speech_stop",
  terminalOpen: "terminal_open",
  terminalWrite: "terminal_write",
  terminalResize: "terminal_resize",
  terminalClose: "terminal_close",
  openExternal: "open_external",
  openPath: "open_path",
  revealPath: "reveal_path",
  previewFile: "preview_file",
  previewFileBytes: "preview_file_bytes",
  previewDir: "preview_dir",
  previewServe: "preview_serve",
  skillsList: "skills_list",
  skillStage: "skill_stage",
  skillInstall: "skill_install",
  skillDiscard: "skill_discard",
  skillDelete: "skill_delete",
  skillSetEnabled: "skill_set_enabled",
  mcpConfigRead: "mcp_config_read",
  mcpConfigWrite: "mcp_config_write",
  mcpList: "mcp_list",
  mcpLogin: "mcp_login",
  mcpLogout: "mcp_logout",
  storageUsage: "storage_usage",
  storageClean: "storage_clean",
  diagnosticsExport: "diagnostics_export",
  updateStatus: "update_status",
  updateWatch: "update_watch",
  updateCheck: "update_check",
  updateSettingsSet: "update_settings_set",
  updateInstall: "update_install",
  logWrite: "log_write",
} as const satisfies Record<keyof Platform, string>;
