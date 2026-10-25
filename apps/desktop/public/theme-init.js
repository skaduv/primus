// 首帧前同步应用深色主题，避免 AppearanceController 挂载前的闪烁。
// 同源脚本，符合 Tauri CSP（default-src 'self'，不允许内联脚本）。
// 读取 zustand persist 的 "primus.appearance"（{ state: { theme } }），规则同 resolveDark。
(() => {
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
