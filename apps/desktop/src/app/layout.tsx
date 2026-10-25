import "./globals.css";
import type { ReactNode } from "react";
import { AppearanceController } from "@/components/theme/appearance-controller";

// 布局只放外壳；页面根组件一律 "use client"（第 16.1.1 节）
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 同源同步脚本：首帧前应用深色主题。CSP 只允许 'self'，不能内联；也不能用 next/script 延后加载 */}
        <script src="/theme-init.js" />
      </head>
      <body>
        <AppearanceController />
        {children}
      </body>
    </html>
  );
}
