import type { NextConfig } from "next";

// 第 16.1.1 节：Next.js 只作为带路由的 React 构建工具使用，静态导出后由 Tauri 嵌入 exe。
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
