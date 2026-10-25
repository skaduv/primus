import { anthropicOAuth } from "./auth/oauth/anthropic.ts";
import { registerBundledOAuthFlowLoaders } from "./auth/oauth/load.ts";
import { openaiChatGPTOAuth } from "./auth/oauth/openai-chatgpt.ts";

/** Register OAuth flows statically embedded in the standalone Bun binary. */
export function registerBunOAuthFlows(): void {
	registerBundledOAuthFlowLoaders({
		anthropic: () => anthropicOAuth,
		openaiChatGPT: () => openaiChatGPTOAuth,
	});
}
