// 扩展 UI 子协议（rpc-extension-ui.md）。
// - 对话框方法（select、confirm、input、editor）：Core 发 extension_ui_request 后阻塞，等前端回
//   带同一 id 的 extension_ui_response；带 timeout 的由 Core 侧超时自动取默认值，前端不必计时。
// - 即发即弃方法（notify、setStatus、setWidget、setTitle、set_editor_text）：不需要响应。
// 扩展 → 前端的结构化数据走 setWidget("primus:<主题>", [JSON 字符串])，见 primus-data.ts。

interface UiRequestBase {
  type: "extension_ui_request";
  id: string;
}

export interface SelectRequest extends UiRequestBase {
  method: "select";
  title: string;
  options: string[];
  /** 毫秒 */
  timeout?: number;
}

export interface ConfirmRequest extends UiRequestBase {
  method: "confirm";
  title: string;
  message: string;
  timeout?: number;
}

export interface InputRequest extends UiRequestBase {
  method: "input";
  title: string;
  placeholder?: string;
  timeout?: number;
}

/** 多行编辑器 */
export interface EditorRequest extends UiRequestBase {
  method: "editor";
  title: string;
  prefill?: string;
}

export interface NotifyRequest extends UiRequestBase {
  method: "notify";
  message: string;
  /** 缺省为 `info` */
  notifyType?: "info" | "warning" | "error";
}

/** `statusText` 缺省表示清除该 key 的状态 */
export interface SetStatusRequest extends UiRequestBase {
  method: "setStatus";
  statusKey: string;
  statusText?: string;
}

/** `widgetLines` 缺省表示清除该 widget；RPC 模式只支持字符串数组 */
export interface SetWidgetRequest extends UiRequestBase {
  method: "setWidget";
  widgetKey: string;
  widgetLines?: string[];
  /** 缺省为 `aboveEditor` */
  widgetPlacement?: "aboveEditor" | "belowEditor";
}

export interface SetTitleRequest extends UiRequestBase {
  method: "setTitle";
  title: string;
}

export interface SetEditorTextRequest extends UiRequestBase {
  method: "set_editor_text";
  text: string;
}

export type ExtensionUiDialogRequest =
  | SelectRequest
  | ConfirmRequest
  | InputRequest
  | EditorRequest;
export type ExtensionUiNotifyRequest =
  | NotifyRequest
  | SetStatusRequest
  | SetWidgetRequest
  | SetTitleRequest
  | SetEditorTextRequest;

export type ExtensionUiRequest = ExtensionUiDialogRequest | ExtensionUiNotifyRequest;
export type ExtensionUiMethod = ExtensionUiRequest["method"];

export const EXTENSION_UI_DIALOG_METHODS = [
  "select",
  "confirm",
  "input",
  "editor",
] as const satisfies readonly ExtensionUiDialogRequest["method"][];

export const EXTENSION_UI_METHODS = [
  ...EXTENSION_UI_DIALOG_METHODS,
  "notify",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
] as const satisfies readonly ExtensionUiMethod[];

export function isDialogRequest(request: ExtensionUiRequest): request is ExtensionUiDialogRequest {
  return (EXTENSION_UI_DIALOG_METHODS as readonly string[]).includes(request.method);
}

// ---------- 前端 → Core 的响应（只用于对话框方法；不会产生 RPC response） ----------

/** select、input、editor：选中的选项或输入的文本 */
export interface ExtensionUiValueResponse {
  type: "extension_ui_response";
  id: string;
  value: string;
}

/** confirm */
export interface ExtensionUiConfirmResponse {
  type: "extension_ui_response";
  id: string;
  confirmed: boolean;
}

/** 关闭任意对话框：扩展收到 undefined（confirm 收到 false） */
export interface ExtensionUiCancelResponse {
  type: "extension_ui_response";
  id: string;
  cancelled: true;
}

export type ExtensionUiResponse =
  | ExtensionUiValueResponse
  | ExtensionUiConfirmResponse
  | ExtensionUiCancelResponse;
