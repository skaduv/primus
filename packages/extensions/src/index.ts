// primus-bundle.js 入口：依次注册各第一方扩展模块（附录 A）。
import guard from "./guard/index.ts";
import context from "./context/index.ts";
import checkpoint from "./checkpoint/index.ts";
import subagent from "./subagent/index.ts";
import plan from "./plan/index.ts";
import shell from "./shell/index.ts";

export default [guard, context, checkpoint, subagent, plan, shell];
