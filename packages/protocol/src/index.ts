// RPC 记录与 primus:* 数据的 TS 类型定义（第 7 章、附录 A）。
// 字段须与锁定版本的 Core RPC 文档逐项对照。

/** primus:* widget 数据的统一外壳 */
export interface PrimusData<T = unknown> {
  v: 1;
  type: string;
  data: T;
}

// TODO: RpcCommand / RpcResponse / RpcEvent / ExtensionUiRequest / ExtensionUiResponse
