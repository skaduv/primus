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
}
