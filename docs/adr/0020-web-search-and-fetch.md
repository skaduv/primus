# ADR 0020：联网搜索与读取网页

- 状态：已采纳（2026-11-19）
- 修订：技术方案第 4.2、4.4 节、第 17.4、17.5 节、第 18 章、附录 A、附录 B；AGENTS.md 第 2.5 节

## 背景

用户希望像 Codex 一样，对话里需要最新信息时 AI 自己联网：不切换模式、不点按钮，AI 判断这句话要不要搜索，必要时打开网页阅读原文。
用户只管对话，联网是否发生、搜了什么、读了哪些页面在工作过程里看得到。

约束：不改 `agent-core/`（第 2.3 节）；对话模型只支持两种协议（C1，不涉及搜索服务）；App 数据只写数据目录（C2）；
密钥不明文落盘（第 2.5 节）；前端不加载在线资源。

## 决定

- **实现为第一方扩展** `packages/extensions/src/web/`（`primus-web`），注册两个自定义工具，由对话模型按工具说明与提示词指引自行判断是否调用：
  - `web_search`：参数 `query`（必填）、`freshness`（`noLimit` / `oneDay` / `oneWeek` / `oneMonth` / `oneYear`，或 `YYYY-MM-DD`、`YYYY-MM-DD..YYYY-MM-DD`，默认 `noLimit`；日期须是真实日历日期、范围开始不晚于结束，无效值按 `noLimit`）、`count`（1–20，默认 8）、`include_domains`、`exclude_domains`。
  - `web_fetch`：参数 `url`（必填）、`find`（最多 200 字，超长直接报错，不截短）、`offset`、`max_chars`（1000–40000，默认 12000）、`version`（续读时带上上次结果给出的正文版本）。
  - 注解都是 `readOnlyHint: true` / `openWorldHint: true`。
- **搜索服务**：内置 LangSearch Web Search API（`POST <地址>/web-search`，Bearer 密钥；按官方文档用 `contents.text` 取网页正文代替短片段，每条限 1200 字（`maxCharacters`），`summary` 照旧带上、返回时优先用），
  不引入 SDK。不走 Core 进程的全局 `fetch`（undici），用 `node:https` 发请求并把 TLS 限制在 1.2（`searchFetch`，见 `transport.ts`）：Node 24 默认的 TLS 1.3 握手（含后量子密钥交换，ClientHello 明显变大）在部分网络链路上连 LangSearch 会被中断，约 11 秒后连接重置或超时，而 TLS 1.2 握手立即成功。代理设置与 Core 一致（`HTTP(S)_PROXY` / `NO_PROXY`，ADR 0015）；搜索地址是内置的固定服务，不做内网地址拦截（兼容代理软件的 fake-ip）。单次超时 20 秒，响应体上限 4 MB。
  给模型的结果是编号、标题、链接、日期、摘要（单条 1200 字、全部 14000 字以内），并提示“摘要不完整时用 web_fetch 打开最相关的链接”；
  不要求模型在回答里标注来源（用户在工作过程里看得到来源）。`details` 为 `WebSearchDetails`（只有标题、网址、域名、日期，不含摘要）。
- **两把内置密钥**：轮流使用；一把遇到网络错误、超时、401 / 403 / 429 / 5xx（含 HTTP 200 但业务码不是 200，或成功响应缺少 `code` / `data`）时换另一把，用户无感；这些状态不读响应体，立即换密钥。
  429 的那把冷却 60 秒，401 / 403 冷却 10 分钟（已有更晚的冷却时保留较晚的）；全部冷却时仍按顺序再试。400 等请求被拒时不换密钥，把原因交给模型。
- **读取网页（仿 Codex 网页工具的 open_page / find_in_page）**：GET 网页，HTML 转成 Markdown 文本（去掉脚本、样式、导航、页脚等，优先取 `<main>` / `<article>`，
  标题、列表、链接、代码块、表格转成 Markdown，不引入依赖）；纯文本、JSON、XML 等原样返回；按 `Content-Type` 与 `<meta>` 编码声明解码（含 GBK；只认 `charset` 属性，或 `http-equiv="content-type"` 时 `content` 里的 `charset=`）。
  长页面分段返回（`offset` 翻页，按 UTF-16 代码单元计、分段边界不切开代理对；续读提示带正文的短哈希 `version`，网页在两次读取之间变了时从开头重新返回并说明，不按旧偏移跳读），带 `find` 时只返回命中处前后 300 字的片段（最多 8 处）。PDF、图片等二进制内容不读取。
  超时 30 秒，响应体最多读 5 MB（超出截断）。`details` 为 `WebFetchDetails`。
- **地址安全**：只允许 http / https、不带用户名密码；不读本机与内网地址（`localhost`、`.local` 等主机名，以及解析到回环、私有、链路本地、组播、文档专用（192.0.2.0/24、198.51.100.0/24、203.0.113.0/24、2001:db8::/32）等地址的域名），
  每一次跳转都重新检查（`redirect: "manual"`，最多 5 次）。域名解析不到地址时拒绝（无法确认目标不在内网；只能经代理解析的域名因此读不了），解析也受超时与取消控制。直连时用 `node:http` / `node:https` 发请求，在建立连接时检查解析出的地址（检查的地址就是连接的地址，防 DNS 重绑定）；配了代理（与 Core 一样认 `HTTP(S)_PROXY` / `NO_PROXY`）时，本地解析并检查后用 CONNECT 让代理连到这个 IP，再在隧道里按原域名做 TLS，代理不再自己解析域名；只支持 http:// 代理，其他代理设置时读取网页报错。代理本身连不上（代理软件已退出，系统代理设置或 Core 启动时拿到的代理变量还留着）时改为直连再试一次（web_search 同样如此）；代理在、但拒绝连接时照常报错。HTTP 101 协议升级不支持（立即报错），204 / 205 / 304 按无正文处理。HTML 转换全程线性扫描（开始标签到引号外的第一个 `>`，引号不闭合时退回第一个 `>`，找不到结束标签即停止；链接地址只解码一次实体；标签名与属性名都完整匹配；补全后的链接地址单个超过 2048 字或累计超过 100 万字时只保留链接文字），畸形页面不会拖住 Core。本机文件仍用 `read`，本机服务用命令行。
  网页内容按不可信的外部数据处理：成功的搜索与读取结果包一层外部内容标注 `<external source="…" trust="untrusted">`（第 17.3 节，内容里的 external 标签转义），联网小节里说明标注内容是数据不是指令；工具说明也要求模型忽略网页里要它执行操作、改指令或泄露信息的文字。
- **地址与密钥**：与内置图片服务相同的做法，只在 `builtin.rs` 一处：地址 `SEARCH_BASE_URL` 明文，两把密钥 `BUILTIN_SEARCH_API_KEYS` 按 `primus-builtin`
  掩码循环异或后以十六进制存放（源码中不出现明文）。薄壳拉起 Core 时设 `PRIMUS_SEARCH_BASE_URL`；扩展用 `execFile` 直接拉起
  `Primus.exe --secret builtin:search`（不经 shell），薄壳确认调用方在本 App 的 Core 作业内才输出（每行一把）。密钥只留在 Core 进程内存里。
  缺少 `PRIMUS_SEARCH_BASE_URL` 或 `PRIMUS_EXE`（浏览器预览、测试）时不注册 `web_search`，`web_fetch` 照常注册。
- **联网开关**：设置·能力中心顶部新增“联网”分组，开关“允许联网搜索与读取网页”（默认开）。薄壳新增命令 `web_settings_get` / `web_settings_set`，
  写 `users/<SID>/app/web.json`（`{"enabled": true}`，不存在或无效时为开），路径经 `PRIMUS_WEB_SETTINGS` 传给 Core。
  `primus-web` 每轮对话开始前（`before_agent_start`）重新读取（读取出错时沿用上次的值，从未读到过则按关闭处理）；隐私设置的“离线模式”（`PRIMUS_OFFLINE=1`）一律视为关闭。
  关闭时用 `setActiveTools` 把两个工具从模型可用的工具里移除，同时改本轮 `systemPromptOptions.selectedTools`，系统提示词里的工具清单随之一致；
  打开时确保两个工具都在（联网开关是它们唯一的启停依据，Core 重启后从会话恢复的清单缺少它们时也会补齐）。执行时再核对一次。
  改设置不需要重启 Core，下一条消息起生效。
- **当前日期**：联网打开时，`primus-web` 在系统提示词里加一个 `<web>` 小节写明当前本地日期（模型据此判断信息是否可能过时、要不要搜索）。
  `primus-web` 排在 `primus-narrate` 之前注册：narrate 返回的整段系统提示词据此已包含工具增减与这一小节。
- **权限**：`primus-guard` 对这两个工具任何模式都放行（含计划模式，它们只读）；是否允许联网由设置里的开关决定，不再逐次询问。
  其他声明联网的工具（MCP 等）仍按原规则询问。
- **界面**：工作过程里连续的联网调用不合并成一行汇总，而是显示成一条“研究轨迹”（参考 BoardUI 的 Web Search 组件，按本项目重新实现）：
  每次搜索一行“已搜索 <关键词>”（地球图标），搜到结果时下面跟一行“来源”：站点标记重叠成一排（最多 6 个，其余显示 +N），
  标记是域名首字母（不加载在线 favicon），悬停显示标题与域名，点击经外链确认用系统浏览器打开；点这一行展开完整的来源列表。
  每次读取一行“已阅读 <网页标题> <域名>”（链接图标），展开显示网址与读到的范围（或查找命中数）。进行中显示“正在搜索 / 正在阅读”的呼吸效果，
  失败标红并在展开后显示原因。新增图标 `globe`（Reicon `Globe`）。工作过程公共部件 `Collapse`、`StepButton` 移到 `work-step.tsx` 共用。

## 影响

- 新增 Core 环境变量 `PRIMUS_SEARCH_BASE_URL`、`PRIMUS_WEB_SETTINGS`；新增设置文件 `users/<SID>/app/web.json`；新增薄壳命令 `web_settings_get` / `web_settings_set`。
- 两把搜索密钥随客户端分发，理论上可被逆向取出，风险与内置渠道、内置图片服务相同；更换时改 `builtin.rs` 后发版。
  威胁模型同 ADR 0018：作业内的任何进程都能取到 `builtin:search`，这是有意接受的。
- 搜索词会发给 LangSearch，读取网页会直接访问对应网站（经系统代理时走代理）；用户可在设置里关闭。
- 询问模式下这两个工具不再逐次确认：与 Codex 一致，联网搜索被视为只读能力，统一由开关控制。
