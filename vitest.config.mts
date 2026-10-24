import { configDefaults, defineConfig } from "vitest/config";

// 根目录 `pnpm test` 只跑本项目代码的单测；agent-core/ 是上游源码，有自己的测试，不在这里跑。
// 前端（jsdom + RTL）用 apps/desktop 自己的配置；其余为 Node 环境。
export default defineConfig({
  test: {
    projects: [
      "apps/desktop/vitest.config.mts",
      {
        test: {
          name: "node",
          include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "agent-core/**", "e2e/**"],
        },
      },
    ],
  },
});
