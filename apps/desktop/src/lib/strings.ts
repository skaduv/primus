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
  errors: {
    title: "出错了",
    retry: "重试",
  },
} as const;

export type Strings = typeof strings;
