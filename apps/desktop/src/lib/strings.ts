// 界面文案集中管理（AGENTS.md：首版只有中文，不得散落硬编码）。
// 以后接入多语言时，以本对象为 zh-CN 基准生成其他语言表。
export const strings = {
  appName: "乾元 Primus",
  pages: {
    home: "乾元 Primus",
    onboarding: "首次引导",
    settings: "设置",
    capabilities: "能力中心",
    storage: "存储",
    usage: "用量统计",
  },
  layout: {
    sessions: "会话",
    timeline: "时间线",
    inspector: "变更 · 文件 · 计划",
    toggleSessions: "显示/隐藏会话列表",
    toggleInspector: "显示/隐藏右侧面板",
    emptyTimeline: "还没有消息。从底部输入框开始一次对话。",
    noSessions: "暂无会话",
  },
  errors: {
    title: "出错了",
    retry: "重试",
  },
} as const;

export type Strings = typeof strings;
