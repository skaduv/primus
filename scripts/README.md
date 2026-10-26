# scripts

| 脚本 | 作用 |
|---|---|
| `build-core.mjs` | `agent-core` 里 `npm ci`，下载并校验锁定的模型目录后离线构建（`build:offline`）；组装 `dist/agent-core/`（最小运行产物 + Core 上游 MIT `LICENSE` + `manifest.json`），下载并校验 Node.js LTS 官方 zip、只解出 `node.exe` 与 `LICENSE` 到 `dist/runtime/`。参数：`--skip-install`、`--skip-build`、`--platform win-x64\|current` |
| `core-dist.mjs` | 上面两步共用的纯函数：SHA-256、`SHASUMS256.txt` 解析、最小 zip 读取与文件过滤、manifest 生成与校验（单测 `core-dist.test.ts`） |
| `node-runtime.json` | 内置 Node.js 运行时的锁定版本与固化哈希（发行包与解出文件） |
| `smoke-core-rpc.mjs` | 启动 `rpc-entry.js`（临时 HOME、离线），发送 `get_state`，校验收到成功 `response`；`--dist` 跑组装好的 `dist/agent-core`（先按 manifest 校验，复制到含中文与空格的临时安装目录，Windows 上用 `dist/runtime/node.exe`），`--entry` / `--node` 可指定入口与运行时 |
| `check-forbidden-sdk.mjs` | 被禁供应商 SDK 检查（C1，技术方案第 6.2 节）：锁文件依赖图、源码逐文件扫描、**导入图**（从 `forbidden-sdk.json` 的 `importGraph` 入口——前端页面、第一方扩展源码与 `primus-bundle.js`、Core 打包前入口与 `dist/agent-core` 产物入口——按 Node.js 解析规则遍历实际加载的文件，含第三方包内部，报告导入链）、**SBOM**（`dist/sbom/*.cdx.json` 中的全部组件）。`--strict` 要求入口与 SBOM 全部存在（CI 构建后使用；每个 glob 都须匹配到文件，`allowEmptyGlobs` 列出的预留模式除外），并输出各图无法解析的第一方导入；`--self-test` 构造经导入图传递引入、仅在 SBOM 中出现被禁 SDK 的临时夹具，确认检查以非零状态退出 |
| `import-graph.mjs` | 导入图解析（exports / imports 条件解析、别名、TS 源码 `.js`→`.ts`、跟随 pnpm/npm 工作区符号链接；跳过仅类型导入），单测 `import-graph.test.ts` |
| `generate-sbom.mjs` | `pnpm build:sbom`：用包管理器自带命令按锁文件生成 CycloneDX SBOM——`pnpm sbom`（工作区）→ `dist/sbom/primus-workspace.cdx.json`，`npm sbom`（agent-core）→ `dist/sbom/agent-core.cdx.json`；CI 上传为制品 `sbom-cyclonedx` |
| `forbidden-sdk.json` | 被禁包名规则、`enforceCore`、导入图入口与 SBOM 配置 |
| `check-tauri-imports.mjs` | 只允许 `src/lib/platform/tauri/` import `@tauri-apps/*` |
| `check-naming.mjs` | `agent-core/` 之外不得出现上游项目原始名称（第 1.3 节） |
| `check-versions.mjs` | 工具链（含 `node-runtime.json`）与依赖版本与 `version-baseline.json`（技术方案第 2.4 节）一致，且全部精确锁定、无预发布版 |
| `version-baseline.json` | 版本基线（含 CI 安装的 cargo-nextest、tauri-driver 版本，`check-versions.mjs` 校验 ci.yml 与之一致）；Renovate 月度 PR 会同步更新它 |
| `build-msi.mjs` | `pnpm build:msi`（仅 Windows；其他平台 `--dry-run` 查看命令）：`--arch x64\|arm64`（默认 x64）决定 Rust 目标（与 rustc 主机不同才加 `--target` 交叉编译）、`wix build -arch`、内置运行时平台（按 manifest 的 `runtime.platform` 校验）与文件名 `Primus_<ver>_<arch>_zh-CN.msi`；校验 `dist/agent-core` 与 manifest、扩展与 `node.exe` 就位、WiX 版本与基线一致 → `tauri build --no-bundle` → 签名 `Primus.exe` → 准备 WebView2 引导程序（缺失时从微软下载，校验微软 Authenticode 签名）→ `wix build`（WiX 7，`-culture zh-CN -acceptEula wix7`，`-bindpath app/core/runtime`，SemVer 按第 3.3.3 节映射为 `ProductVersion`：第三字段 = 修订 × 100 + 阶段偏移，alpha/beta/rc.N → N/30+N/60+N，稳定版 → 99，保证稳定版高于同版本预发布版）→ 签名 MSI → `.sha256` → `tauri signer` 生成 `.sig`。签名只在配置了 `PRIMUS_SIGN_CERT_SHA1`、`PRIMUS_SIGN_TIMESTAMP_URL`、`TAURI_SIGNING_PRIVATE_KEY` 时执行。参数：`--version`（与 `tauri.conf.json` 不同时经 `tauri build --config` 同步给 `Primus.exe`；与 `--skip-tauri` 同用且版本不同则拒绝）、`--skip-tauri`（校验签名后写在 exe 旁的 `Primus.exe.build.json`：版本、架构、大小、修改时间须与本次一致，否则拒绝）、`--out-dir`、`--webview2`、`--dry-run`（单测 `build-msi.test.ts`） |
| `build-nsis.mjs` | `pnpm build:nsis`（仅 Windows；其他平台 `--dry-run`）：`tauri bundle --bundles nsis` 打包 `build-msi.mjs` 刚编译的同版本、同架构 `Primus.exe`（按 `Primus.exe.build.json` 校验，不重新编译）；临时配置把产品名设为「乾元 Primus」、把 `dist/runtime`、`dist/agent-core` 收进 `resources\runtime`、`resources\agent-core`（与 MSI 布局一致），其余 NSIS 设置（简体中文、按机器安装、内嵌 WebView2 引导程序、许可页、`windows/nsis/hooks.nsh` 给 `data` 授予 Users 修改）在 `tauri.conf.json`；输出 `out/Primus_<ver>_<arch>-setup.exe` 与 `.sha256`（单测 `build-nsis.test.ts`） |
| `msi-smoke.ps1` | MSI 静默安装 → 检查安装布局（按 manifest 逐个校验 Core 文件哈希、`node.exe` 签名、卸载信息、开始菜单快捷方式）→ `data` 的 ACL 含 `BUILTIN\Users` 显式修改 (M) 且继承；有 gsudo 时以中完整性级别实际写入 `data`、并确认写不进安装目录根 → WebView2 检测 / 引导是否按预期 → 用安装目录的 `node.exe` 跑 Core RPC 冒烟 → 静默卸载，程序与快捷方式移除、`data` 及其中文件保留 → 清理。需管理员；参数 `-InstallDir`、`-KeepInstalled`、`-KeepData`；CI 与安装测试虚拟机共用 |
| `nsis-smoke.ps1` | NSIS 安装程序 `/S /D=` 静默安装 → 检查布局（按 manifest 校验 Core 文件哈希、`node.exe` 签名、卸载信息的显示名 / 版本 / 发布者、开始菜单快捷方式）→ `data` 的 ACL 与中完整性级别写入（有 gsudo 时）→ 安装目录中的 `node.exe` 跑 RPC 冒烟 → `uninstall.exe /S _?=` 卸载，程序与快捷方式移除、`data` 保留 |
| `check-installers.ps1` | CI 与发布共用：`out/` 中某架构恰有一个 MSI 与一个 NSIS EXE、文件名版本与 `tauri.conf.json` 一致、< 120MB、`.sha256` 一致、MSI 平台为 `x64;2052` / `Arm64;2052`、`Primus.exe` 的 PE Machine 与架构一致；写入 `PRIMUS_MSI`、`PRIMUS_NSIS` |
| `vm/New-PrimusTestCheckpoint.ps1` | Hyper-V 宿主机上把安装测试虚拟机正常关机后建立 `clean` 检查点（可选启用来宾服务接口；同名已存在须 `-Force`），见 `vm/README.md` |
| `vm/Reset-PrimusTestVM.ps1` | 一键还原检查点 → 启动并等待检测信号与 PowerShell Direct → 复制 MSI 与 `msi-smoke.ps1` 进来宾（PowerShell Direct 或 Copy-VMFile）→ 可选执行冒烟 → 拉回日志；凭据用 `Get-Credential`，不硬编码。手工测试项见 `docs/安装测试清单.md` |
