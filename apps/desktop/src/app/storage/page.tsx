"use client";

import { WindowTitleBar } from "@/components/layout/window-controls";
import { strings } from "@/lib/strings";

// 存储
export default function StoragePage() {
  return (
    <>
      <WindowTitleBar />
      <main>{strings.pages.storage}</main>
    </>
  );
}
