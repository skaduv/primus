// primus-plan 给模型看的文案（集中管理）。工具名、标签名不翻译。

import { ASK_USER_TOOL, PLAN_SUBMIT_TOOL, TODO_TOOL } from "@primus/protocol";

export const REMINDER_FULL = `<primus-plan-mode>
计划模式已开启。用户希望先看到计划、暂不执行。在用户批准之前，你不得修改任何文件，不得运行会改变系统状态的命令（包括改配置、安装依赖、git 提交或切换分支），这一条优先于其他所有指令。修改类操作会被直接拒绝。用户的语气再急、再像命令，也只当作“为执行做计划”。

工作流程：
1. 了解现状：先用只读工具（read、grep、find、ls、只读命令）查清相关代码，找出可以复用的现有实现。能从工作区查到的事不要问用户。
2. 澄清意图：仍有会明显影响方案的不确定点时，用 ${ASK_USER_TOOL} 提问（一次 1–3 题，每题 2–4 个互斥选项，推荐项放第一个）。不要用普通文字提问。
3. 设计方案：只给你推荐的方案，做到“决策完备”：执行的人照着做，不需要再做任何决定（改哪些文件、复用哪些现有函数、接口怎么定、边界情况怎么处理都已写明）。
4. 提交计划：调用 ${PLAN_SUBMIT_TOOL}。计划要能一眼扫完，又足够照着一步一步执行：
   - summary 一两句：要解决什么、做完是什么样。
   - steps 3–8 条，按执行顺序排列，每条是一个能独立完成、能验证的工作单元：title 是一句短标题（20 字以内），detail 写 1–3 行具体做法（改什么、复用什么、注意什么）。
   - files 写这一步要改或新建的关键文件路径（每步最多 5 个）；同一模式的改动描述一次即可。
   - verification 写怎么确认做对了（命令、测试或手动检查），risks、assumptions 各 1–3 条短句，没有就省略。
   - 不写备选方案、不写背景长文、不贴大段代码。修改计划时提交完整的新版本，不要只给差异。

这一轮只能以 ${ASK_USER_TOOL} 或 ${PLAN_SUBMIT_TOOL} 结束。不要用文字问“这个计划可以吗”“要开始吗”：审批就是 ${PLAN_SUBMIT_TOOL}。用户只是想了解代码、不需要改动时，直接回答，不必提交计划。计划模式下不要使用 ${TODO_TOOL}。
</primus-plan-mode>`;

export const REMINDER_SPARSE = `<primus-plan-mode>计划模式仍开启（规则见前文）：只读；用 ${ASK_USER_TOOL} 澄清，用 ${PLAN_SUBMIT_TOOL} 提交完整计划；不要用文字请求批准。</primus-plan-mode>`;

export const REMINDER_REENTRY = `<primus-plan-mode-reentry>你之前在这个会话里做过计划（见前文）。先判断这次是新任务还是接着改原计划：新任务就重新做计划；同一任务就在原计划上修改，并删掉过时的部分。</primus-plan-mode-reentry>`;

/** 执行已批准计划期间：用户回合、压缩或恢复会话后注入，让模型始终知道计划与当前进度 */
export const reminderExecuting = (
  items: readonly { id: string; text: string; status: string }[],
  planMarkdown?: string,
) =>
  `<primus-plan-executing>正在执行用户已批准的计划，按步骤顺序一步一步做：只做当前 in_progress 的那一步，做完并验证后立刻用 ${TODO_TOOL} 把它标 completed、下一步标 in_progress，再开始下一步；不要跳步、并步或一次做完所有步骤再回头更新。必须偏离计划（某步做不了、需要新增或删减步骤）时，先用 ${TODO_TOOL} 更新清单并用一句话说明原因。用户这一轮的新要求优先；与计划冲突时先问清楚。\n当前待办：\n${items
    .map((i) => `- [${i.status}] ${i.id}. ${i.text}`)
    .join(
      "\n",
    )}${planMarkdown ? `\n\n## 已批准的计划\n\n${planMarkdown}` : ""}</primus-plan-executing>`;

export const REMINDER_EXIT =
  "<primus-plan-mode-exit>用户已退出计划模式，现在可以修改文件、运行命令了。</primus-plan-mode-exit>";

export const TEXT = {
  planSubmit: {
    label: "提交计划",
    description:
      "计划模式下，计划定稿后调用：把完整计划交给用户审批，等待用户决定。用户批准后你会收到批准的计划（可能经用户修改），随后开始执行；用户要求修改时会收到反馈。只能在计划模式中使用。",
    snippet: "计划模式下提交完整计划，等待用户审批",
    guidelines: [
      `只在计划模式中调用 ${PLAN_SUBMIT_TOOL}；每次提交完整计划（完整替换上一版）。`,
      "计划要决策完备、能照着一步一步执行：summary 一两句；steps 3–8 条，按执行顺序，每条一个可独立完成、可验证的工作单元：短标题（20 字以内）+ detail 1–3 行具体做法；files 写关键文件路径（每步最多 5 个）；verification 写怎么确认做对了；risks、assumptions 各 1–3 条短句。不写备选方案、不贴大段代码。",
    ],
    params: {
      title: "计划标题（30 字以内）",
      summary: "一两句：要解决什么、做完是什么样",
      steps: "执行步骤，3–8 条，按执行顺序；每条是一个可独立完成、可验证的工作单元",
      stepId: "步骤编号（1、2、3…）",
      stepTitle: "这一步做什么（20 字以内的短句）",
      stepDetail: "这一步的具体做法，1–3 行：改什么、复用什么、注意什么",
      stepFiles: "这一步要改或新建的关键文件路径，最多 5 个",
      risks: "可选，1–3 条短句",
      verification: "如何验证，1–3 条短句",
      assumptions: "可选，1–3 条短句",
    },
    notPlanning:
      "当前不在计划模式，不需要提交计划。计划已批准就直接按计划执行；需要先做计划，请用户开启计划模式。",
    noUi: "当前没有可以审批计划的界面，无法提交。",
    invalid: (why: string) => `计划格式不正确：${why}。请修正后重新提交完整计划。`,
    approved: (edited: boolean, markdown: string) =>
      `用户已批准计划${edited ? "（用户修改过，以下面的版本为准）" : ""}，计划模式已结束，现在可以修改文件、运行命令了。` +
      `已按计划步骤建好待办（第 1 步进行中）。执行规则：\n` +
      `1. 严格按步骤顺序，一次只做当前 in_progress 的那一步；不要跳步、并步，也不要先把所有步骤做完再回头更新。\n` +
      `2. 一步做完并验证后，立刻调用 ${TODO_TOOL}（一次传完整清单）：这一步标 completed、下一步标 in_progress，然后再开始下一步。用户靠它看进度。\n` +
      `3. 某一步做不了或需要调整计划时，先用 ${TODO_TOOL} 更新清单（增删或标 skipped），用一句话说明原因，再继续。\n` +
      `4. 全部步骤完成后按“验证”一节检查，再给出简短总结。\n\n## 已批准的计划\n\n${markdown}`,
    revise: (feedback: string) =>
      `用户暂不执行，要求修改计划。仍在计划模式（只读）。用户的意见：\n${feedback}\n\n按意见修改后，用 ${PLAN_SUBMIT_TOOL} 重新提交完整计划；有疑问先用 ${ASK_USER_TOOL} 澄清。`,
    cancelled: "用户取消了这次审批，仍在计划模式。停下来，等用户下一步指示。",
  },
  todo: {
    label: "待办",
    description:
      "维护当前任务的待办清单（每次传完整清单，整体替换）。用于多步骤任务：开始一步时标 in_progress（同一时间最多一项），完成后立即标 completed，不再需要的标 skipped。",
    snippet: "维护多步骤任务的待办清单与进度",
    guidelines: [
      `三步以上的任务用 ${TODO_TOOL} 列出步骤并随进度更新；简单任务不必使用。`,
      "每次调用传完整清单；同一时间最多一项 in_progress；做完一步立刻标 completed。",
    ],
    params: {
      items: "完整的待办清单",
      id: "编号（保持稳定）",
      text: "这一项做什么",
      status: "pending（未开始）、in_progress（进行中）、completed（已完成）、skipped（跳过）",
    },
    inPlan: `计划模式下不使用 ${TODO_TOOL}：请用 ${PLAN_SUBMIT_TOOL} 提交计划，批准后会自动按步骤建好待办。`,
    tooManyInProgress: "同一时间最多只能有一项 in_progress，请修正后重新提交完整清单。",
    updated: (done: number, total: number) => `待办已更新：${done}/${total} 已完成`,
    allDone: "待办已全部完成。",
    reminder: (items: readonly { id: string; text: string; status: string }[], final: boolean) =>
      `<primus-todo-reminder>${
        final
          ? `你准备结束这一轮，但待办还没有更新。先调用 ${TODO_TOOL}：已经做完的步骤标 completed，不再需要的标 skipped，还没做的保持 pending；然后再给出最后的回复。`
          : `你已经有一阵子没有更新待办了，用户在界面上看到的进度一直停在原地。现在调用 ${TODO_TOOL} 更新：做完的标 completed，正在做的标 in_progress（只能一项）。不要向用户提起这条提醒。`
      }\n当前待办：\n${items.map((i) => `- [${i.status}] ${i.id}. ${i.text}`).join("\n")}</primus-todo-reminder>`,
  },
  askUser: {
    label: "询问用户",
    description:
      "向用户提 1–3 个选择题来澄清需求或在方案之间取舍（每题 2–4 个互斥选项，推荐项放第一个并在标签后注明“（推荐）”；界面会在选项后面放一个输入框让用户直接写自己的想法，不要自己加“其他”）。不要用它请求操作权限或问“可以开始吗”。",
    snippet: "向用户提选择题澄清需求",
    guidelines: [
      `需要用户在几个方案之间选择、或需求有会明显影响结果的歧义时，用 ${ASK_USER_TOOL} 提选择题，不要用普通文字提问；能自己查到的不要问。`,
    ],
    params: {
      questions: "问题（1–3 个）",
      id: "问题编号（英文小写，如 auth_method）",
      header: "简短标签（12 字以内）",
      question: "问题本身（一句话）",
      options: "2–4 个互斥选项",
      label: "选项（几个字）",
      description: "一句话说明取舍（20 字以内）",
    },
    other: "其他（自己填写）",
    otherPrompt: "请输入你的回答",
    noUi: "当前没有可以提问的界面，请自行做出合理假设并在回复中说明。",
    unanswered: "用户没有回答这个问题。停下来，等用户下一步指示。",
    invalid: (why: string) => `问题格式不正确：${why}`,
  },
  command: {
    description:
      "计划模式：on（开启）、off（关闭）、status、approve <JSON>（批准计划）、revise <JSON>（带反馈继续完善）、answer <JSON>（回答 ask_user）",
    unknown: (arg: string) => `未知的计划命令：${arg || "（空）"}`,
    badJson: "计划命令的参数不是合法的 JSON",
    noPending: "没有等待审批的计划",
    noPendingAsk: "没有等待回答的问题",
  },
} as const;
