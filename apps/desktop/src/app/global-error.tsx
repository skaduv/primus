"use client";

import { strings } from "@/lib/strings";

// 全局错误兜底：根布局本身出错时显示（必须自带 <html>/<body>）
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <h2>{strings.errors.title}</h2>
        <button type="button" onClick={() => reset()}>
          {strings.errors.retry}
        </button>
      </body>
    </html>
  );
}
