// 平台接口：前端通过它调用薄壳命令（附录 B），不直接依赖 Tauri。
export interface Platform {
  appInfo(): Promise<unknown>;
  sessionOpen(workspace: string, sessionPath?: string): Promise<{ sessionKey: string }>;
  coreSend(sessionKey: string, record: unknown): Promise<void>;
  // TODO: 按附录 B 补全
}
