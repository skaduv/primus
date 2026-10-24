import { configDefaults, defineConfig } from "vitest/config";

// 根目录 `pnpm test` 只跑本项目代码的单测；agent-core/ 是上游源码，有自己的测试，不在这里跑
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "agent-core/**", "e2e/**"],
  },
});
