import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { anthropicOAuth } from "../src/auth/oauth/anthropic.ts";
import { openaiChatGPTOAuth } from "../src/auth/oauth/openai-chatgpt.ts";
import { createModels } from "../src/models.ts";
import * as extensionOAuthCompatibility from "../src/oauth.ts";
import { anthropicProvider } from "../src/providers/anthropic.ts";
import { openaiProvider } from "../src/providers/openai.ts";

const neverAbortedSignal = new AbortController().signal;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe.sequential("OAuthAuth adapters", () => {
	it("keeps the extension OAuth barrel free of built-in flow implementations", () => {
		expect(extensionOAuthCompatibility).not.toHaveProperty("loginAnthropic");
		expect(extensionOAuthCompatibility).not.toHaveProperty("anthropicOAuth");
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("identifies only subscription-backed OAuth flows as subscriptions", () => {
		for (const oauth of [anthropicOAuth, openaiChatGPTOAuth]) {
			expect(oauth.isSubscription).toBe(true);
		}
	});

	it("anthropic toAuth derives the api key from the access token", async () => {
		const auth = await anthropicOAuth.toAuth({ type: "oauth", access: "token", refresh: "r", expires: 0 });
		expect(auth).toEqual({ apiKey: "token" });
	});

	it("OpenAI exposes ChatGPT OAuth alongside API-key auth", () => {
		const provider = openaiProvider();
		expect(provider.auth.apiKey).toBeDefined();
		expect(provider.auth.oauth).toMatchObject({
			name: "OpenAI (ChatGPT subscription)",
			isSubscription: true,
			loginLabel: "Sign in with ChatGPT",
		});
	});

	it("anthropic refresh exchanges the refresh token and returns a typed credential", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
			),
		);

		const refreshed = await anthropicOAuth.refresh(
			{ type: "oauth", access: "old", refresh: "old-r", expires: 0 },
			neverAbortedSignal,
		);
		expect(refreshed.type).toBe("oauth");
		expect(refreshed.access).toBe("new-access");
		expect(refreshed.refresh).toBe("new-refresh");
		expect(refreshed.expires).toBeGreaterThan(Date.now());
	});
});

describe("OAuth through Models.getAuth (lazy load chain)", () => {
	it("resolves stored anthropic oauth credentials via the lazy flow import", async () => {
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "r",
			// Keep this beyond getAuth()'s refresh window.
			expires: Date.now() + 10 * 60_000,
		}));
		const models = createModels({ credentials });
		models.setProvider(anthropicProvider());

		const model = models.getModels("anthropic")[0];
		const result = await models.getAuth(model.provider);
		expect(result?.auth.apiKey).toBe("oauth-access-token");
		expect(result?.source).toBe("OAuth");
	});
});
