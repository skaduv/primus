"use client";

// 全局的选中复制处理（见 lib/clean-copy.ts）：复制出的富文本不带应用的字体、颜色与图标，文件引用为完整路径。
import { useEffect } from "react";
import { handleCopy } from "@/lib/clean-copy";

export function CleanCopy() {
  useEffect(() => {
    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, []);
  return null;
}
