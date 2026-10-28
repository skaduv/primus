"use client";

import { WindowTitleBar } from "@/components/layout/window-controls";
import { strings } from "@/lib/strings";

// 能力中心
export default function CapabilitiesPage() {
  return (
    <>
      <WindowTitleBar />
      <main>{strings.pages.capabilities}</main>
    </>
  );
}
