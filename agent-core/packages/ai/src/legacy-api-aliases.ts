import { anthropicMessagesApi } from "./api/anthropic-messages.lazy.ts";
import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import { openAIResponsesApi } from "./api/openai-responses.lazy.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses.ts";
import type { SimpleStreamOptions, StreamFunction } from "./types.ts";

const anthropicMessagesStreams = anthropicMessagesApi();
const openAIResponsesStreams = openAIResponsesApi();

/** @deprecated Use `stream` from `@earendil-works/pi-ai/api/anthropic-messages` or `anthropicMessagesApi().stream`. */
export const streamAnthropic = anthropicMessagesStreams.stream as StreamFunction<
	"anthropic-messages",
	AnthropicOptions
>;
/** @deprecated Use `streamSimple` from `@earendil-works/pi-ai/api/anthropic-messages` or `anthropicMessagesApi().streamSimple`. */
export const streamSimpleAnthropic = anthropicMessagesStreams.streamSimple as StreamFunction<
	"anthropic-messages",
	SimpleStreamOptions
>;

/** @deprecated Use `stream` from `@earendil-works/pi-ai/api/openai-responses` or `openAIResponsesApi().stream`. */
export const streamOpenAIResponses = openAIResponsesStreams.stream as StreamFunction<
	"openai-responses",
	OpenAIResponsesOptions
>;
/** @deprecated Use `streamSimple` from `@earendil-works/pi-ai/api/openai-responses` or `openAIResponsesApi().streamSimple`. */
export const streamSimpleOpenAIResponses = openAIResponsesStreams.streamSimple as StreamFunction<
	"openai-responses",
	SimpleStreamOptions
>;
