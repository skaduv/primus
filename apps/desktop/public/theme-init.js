// 首帧前同步应用深色主题，避免 AppearanceController 挂载前的闪烁。
// 同源脚本，符合 Tauri CSP（default-src 'self'，不允许内联脚本）。
// 读取 zustand persist 的 "primus.appearance"（{ state: { theme } }），规则同 resolveDark。
(() => {
  // 在 Tauri 窗口内（初始化脚本先于页面注入 isTauri）：页面背景透明，透出窗口的亚克力磨砂效果
  if (window.isTauri === true) {
    document.documentElement.classList.add("window-effects");
    // Win10 没有系统背景材质，亚克力退回旧接口后几乎不着色、只剩模糊的桌面，显得发灰发脏：改用实色背景。
    // 判断方法与 src/lib/platform/tauri/window.ts 的 isLegacyWindows 一致（platformVersion 主版本 ≥ 13 为 Win11）
    navigator.userAgentData
      ?.getHighEntropyValues?.(["platformVersion"])
      .then((v) => {
        const major = Number.parseInt(String(v.platformVersion ?? "").split(".")[0] ?? "", 10);
        if (v.platform === "Windows" && major > 0 && major < 13) {
          document.documentElement.classList.add("solid-window");
        }
      })
      .catch(() => {});
  }
  try {
    const raw = localStorage.getItem("primus.appearance");
    const theme = raw ? JSON.parse(raw)?.state?.theme : undefined;
    const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
    const dark = theme === "dark" || ((theme === undefined || theme === "system") && systemDark);
    document.documentElement.classList.toggle("dark", dark);
  } catch {
    // 存储不可用或内容损坏时保持默认，交给 AppearanceController 处理
  }
})();
