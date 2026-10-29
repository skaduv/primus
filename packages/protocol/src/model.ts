// 模型对象（rpc-commands.md「Model object」）：get_state、set_model、cycle_model、
// get_available_models 返回完整的模型定义。费用单位：美元 / 百万 token。

import type { JsonObject, ThinkingLevel } from "./content.ts";

/** 两协议约束（C1）：Core 只保留这两种 API */
export type ModelApi = "openai-responses" | "anthropic-messages";

export type ModelInputModality = "text" | "image";

export interface ModelCostRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** 按请求输入量分档的价格：命中的最高门槛适用于整个请求 */
export interface ModelCostTier extends ModelCostRates {
  inputTokensAbove: number;
}

export interface ModelCost extends ModelCostRates {
  tiers?: ModelCostTier[];
}

export interface ModelImageResizeOptions {
  maxWidth?: number;
  maxHeight?: number;
  /** base64 编码后的最大字节数 */
  maxBytes?: number;
  jpegQuality?: number;
}

export interface ModelInputLimits {
  maxRequestBytes?: number;
  images?: {
    resize?: ModelImageResizeOptions;
    maxPerMessage?: number;
    maxPerRequest?: number;
  };
}

/** 各思考强度对应的供应商取值；`null` 表示该档不支持 */
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

/** 各保留档位的提示缓存时长（秒） */
export type ModelPromptCache = Partial<Record<"short" | "long", number>>;

export type SamplingParams = Record<string, unknown>;

export interface Model {
  id: string;
  name: string;
  api: ModelApi;
  provider: string;
  baseUrl: string;
  input: ModelInputModality[];
  inputLimits?: ModelInputLimits;
  cost: ModelCost;
  headers?: Record<string, string>;
  /** 缺省即对话模型 */
  type?: "chat";
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  promptCache?: ModelPromptCache;
  contextWindow: number;
  maxTokens: number;
  samplingParams?: SamplingParams;
  samplingParamsByThinkingLevel?: Partial<Record<ThinkingLevel, SamplingParams>>;
  /** 协议兼容覆盖项，内容随 api 而定，按不透明值处理 */
  compat?: JsonObject;
}
