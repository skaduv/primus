import "./globals.css";
import type { ReactNode } from "react";

// 布局只放外壳；页面根组件一律 "use client"（第 16.1.1 节）
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
