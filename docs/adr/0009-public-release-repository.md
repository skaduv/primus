# 0009 私有源码仓与公开发布仓

- 状态：已接受
- 日期：2026-11-13

## 背景

Primus 的源码仓需要保持私有，但 Windows 安装包、自动更新清单和手动下载页面必须能被未登录用户匿名访问。GitHub 私有仓库的 Release 附件不提供匿名下载；应用更新器也不会携带 GitHub 登录状态。若让客户端使用 GitHub Token，会把长期凭证分发到所有安装，超出更新组件应有的权限。

## 决策

- 源码、CI、updater 私钥和发布凭证保留在私有仓 `skaduv/primus`。
- 新建公开仓 `skaduv/primus-releases`，只保存 MSI、Release 正文与 `update-feed` 下的 `stable.json` / `beta.json`，不保存源码。
- 私有仓的发布工作流在 x64 / ARM64 构建和安装冒烟全部成功后，先在源码仓 `skaduv/primus` 创建（或更新）版本 Release、上传两个 MSI，再在同一个发布作业里把同样的附件与正文同步到公开仓，最后更新公开仓的 `update-feed`（2026-11-13 修订：发布版本先落在源码仓，便于在源码仓按版本追溯；原先只发公开仓）。同步与清单更新在同一作业内顺序完成，清单只在公开 Release 就绪后才指向它，不出现同步窗口。
- 两个仓库的 Release 由同一脚本 `scripts/publish-release.sh` 生成，附件、正文、prerelease / Latest 状态一致；`update-feed` 只在公开仓维护。只发到公开仓的旧版本可用发布工作流的 `backfill_source` 手动回填到源码仓。
- 使用 Fine-grained Token `PRIMUS_RELEASES_TOKEN`，只授权 `skaduv/primus-releases` 的 `Contents: Read and write`，保存在私有仓的 Actions Secret 中。默认 `GITHUB_TOKEN` 用于读取源码仓和写源码仓的 Release（发布作业 `contents: write`）。
- 客户端只读取公开仓的静态 Release URL；公开仓不运行源码，也不持有签名私钥。

## 后果

- 源码保持私有，用户无需 GitHub 账号即可下载和自动更新。
- 每次发布多依赖一个可轮换的跨仓库 Token；Token 过期或撤销会让发布在创建公开 Release 时失败，不影响已发布版本。
- Token 泄露不能伪造 updater 签名，但可以篡改公开下载内容；客户端仍会因签名不符拒绝安装，发现后应撤销 Token 并重新发布。
- GitHub 会为公开 Release 自动生成该公开仓的源码归档；由于公开仓只有 README，不会暴露私有源码。
- 公开仓只有 README，GitHub 按公开仓提交生成的变更说明没有内容，发布不再使用 `--generate-notes`；Release 正文只有限制说明、安装包与校验值，变更说明需要时手动补充。
- 0.0.9 及更早的安装从 `skaduv/primus` 的 `update-feed` 读取清单；源码仓转为私有后这些地址无法匿名访问，旧安装收不到自动更新（检查失败只记日志），需要从公开仓手动下载安装一次新版本，之后从公开仓自动更新。
