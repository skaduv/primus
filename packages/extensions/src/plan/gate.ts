// 计划模式与 primus-guard 之间的共享开关（同一个 primus-bundle.js 内的模块级状态，不经 Core）。
// guard 最先注册、Core 按注册顺序执行 tool_call 且第一个 block 生效，所以计划模式的只读约束由 guard 执行：
// plan 模块只负责把“现在是否在计划中”写到这里，guard 每次判断前读取。

export interface PlanGate {
  /** 计划中或等待审批：只读 */
  readOnly: boolean;
}

export function createPlanGate(): PlanGate {
  return { readOnly: false };
}

/** primus-bundle.js 内唯一的开关（每个 Core 进程一个会话） */
export const planGate: PlanGate = createPlanGate();
