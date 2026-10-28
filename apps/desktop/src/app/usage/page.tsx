"use client";

import { WindowTitleBar } from "@/components/layout/window-controls";
import { strings } from "@/lib/strings";

// 用量统计
export default function UsagePage() {
  return (
    <>
      <WindowTitleBar />
      <main>{strings.pages.usage}</main>
    </>
  );
}
