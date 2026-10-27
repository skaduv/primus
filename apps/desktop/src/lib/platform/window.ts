// 窗口控制接口：主窗口去掉系统标题栏（decorations: false）后，由前端顶栏自绘最小化/最大化/关闭按钮。
// 这些是 Tauri 内置的窗口操作，不是附录 B 的薄壳命令，所以不放进 Platform / COMMANDS。
// 浏览器预览（mock）由浏览器自己提供窗口外框，返回 undefined，顶栏不显示窗口按钮。

export interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** 窗口最大化状态变化时回调（含双击拖动区、Win+↑、贴靠布局），返回取消监听函数 */
  onMaximizedChange(listener: (maximized: boolean) => void): Promise<() => void>;
  /**
   * 侧栏展开/收起时把窗口向该侧加宽（delta>0）或收窄（delta<0），保持中央界面在屏幕上不动、不变宽。
   * delta 为逻辑像素；left 侧同时移动窗口左边缘。ease 为 0→1 的缓动函数。
   * 最大化时不调整，返回 false，由界面退回到挤压中央的布局。
   */
  resizeBySide(
    side: "left" | "right",
    delta: number,
    durationMs: number,
    ease: (t: number) => number,
  ): Promise<boolean>;
}
