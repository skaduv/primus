"use client";

import { WindowTitleBar } from "@/components/layout/window-controls";
import { strings } from "@/lib/strings";

// 首次引导
export default function OnboardingPage() {
  return (
    <>
      <WindowTitleBar />
      <main>{strings.pages.onboarding}</main>
    </>
  );
}
