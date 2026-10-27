// 窗口控制接口：主窗口去掉系统标题栏（decorations: false）后，由前端顶栏自绘最小化/最大化/关闭按钮。
// 这些主要是 Tauri 内置的窗口操作，不放进 Platform / COMMANDS；侧栏伸缩用到的 window_set_bounds 记在附录 B。
// 浏览器预览（mock）由浏览器自己提供窗口外框，返回 undefined，顶栏不显示窗口按钮。

export interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** 窗口最大化状态变化时回调（含双击拖动区、Win+↑、贴靠布局），返回取消监听函数 */
  onMaximizedChange(listener: (maximized: boolean) => void): Promise<() => void>;
  /**
   * 侧栏展开/收起时窗口向该侧逐帧伸缩 delta 逻辑像素（>0 加宽，<0 收窄），duration 毫秒内按 ease 曲线走完；
   * onFrame 每帧回报已走的逻辑像素，界面据此同步侧栏宽度。left 侧左边缘与宽度原子地一起变，右边缘不动。
   * 最大化时不调整，返回 false。
   */
  animateBySide(
    side: "left" | "right",
    delta: number,
    duration: number,
    ease: (t: number) => number,
  ): Promise<boolean>;
}
