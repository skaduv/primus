# 0002 界面采用 Liquid Glass 风格，基础组件取自 lore-glass

- 状态：已接受
- 日期：2026-10-25

## 背景
第 1 周第 7 项（主界面低保真线框）需要确定视觉方向。产品负责人要求以 lore-glass（loreglasses.com）为底层，做出 macOS 27 的液态玻璃效果。技术方案第 16.1 节规定组件用 Radix UI，并按 shadcn/ui 的方式把源码放进仓库。

## 决策
- 视觉采用 Liquid Glass：窗口底层是柔和的壁纸渐变；侧栏、检查器、工具栏按钮、输入框、菜单、提示等浮在上面的元素用玻璃；时间线与设置内容放在实色"纸面"上。
- 基础组件取自 lore-glass（MIT），以源码形式放在 `apps/desktop/src/components/ui/`。依赖 `@base-ui/react` 的组件（Tabs、Tooltip、Dialog、Popover）改写为 Radix 原语，不引入第二套无障碍组件库，也不新增运行时依赖。
- 玻璃着色程度做成设置项（对应 iOS / macOS 27 的外观滑块）；系统开启"减少透明度"时自动用完全着色；支持浅色、深色、跟随系统。

## 后果
- WebView2 基于 Chromium，`GlassSurface` 能用 SVG 位移贴图做真实折射；在不支持的环境自动降级为模糊 + 着色。
- `backdrop-filter` 成本高，长列表（时间线、文件树）不套玻璃，以保证第 16.5 节 60fps 的流式渲染目标；性能测试时重点看输入框（悬浮在滚动内容上方）。
- 第三方文件的改动登记在 `components/ui/README.md`，不经 Biome 与 CodeRabbit 逐行检查，升级时按表重放。
