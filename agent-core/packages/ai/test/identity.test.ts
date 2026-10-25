import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	formatUserAgent,
	getAttributionHeaders,
	getIdentityHeaders,
	mergeClientIdentity,
	PI_ATTRIBUTION,
} from "../src/utils/identity.ts";
import { PI_AI_VERSION } from "../src/utils/version.ts";

const ACME = { name: "acme", url: "https://acme.example" };

const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;

function target(provider: string, baseUrl: string) {
	return { provider, baseUrl };
}

describe("client identity", () => {
	it("keeps the version constant in sync with package.json", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
		expect(PI_AI_VERSION).toBe(pkg.version);
	});

	it("formats user agents", () => {
		expect(formatUserAgent()).toBe(`primus/${PI_AI_VERSION} (${process.platform}; ${runtime}; ${process.arch})`);
		expect(formatUserAgent({ version: "9.9.9" })).toBe(
			`primus/9.9.9 (${process.platform}; ${runtime}; ${process.arch})`,
		);
		expect(formatUserAgent({ userAgent: "short", version: "9.9.9" })).toBe("primus");
		expect(formatUserAgent({ userAgent: { custom: "acme/1.0" } })).toBe("acme/1.0");
	});

	it("merges identities field by field", () => {
		expect(mergeClientIdentity(undefined, undefined)).toBeUndefined();
		expect(
			mergeClientIdentity(
				{ attribution: PI_ATTRIBUTION, userAgent: "short" },
				{ attribution: undefined, version: "1.0.0" },
			),
		).toEqual({ attribution: PI_ATTRIBUTION, userAgent: "short", version: "1.0.0" });
		expect(mergeClientIdentity({ attribution: PI_ATTRIBUTION }, { attribution: null })).toEqual({
			attribution: null,
		});
	});

	it("sends no attribution unless enabled", () => {
		const openRouter = target("openrouter", "https://openrouter.ai/api/v1");
		expect(getAttributionHeaders(openRouter)).toEqual({});
		expect(getAttributionHeaders(openRouter, { attribution: null })).toEqual({});
		expect(getIdentityHeaders(openRouter)).toEqual({ "User-Agent": formatUserAgent() });
	});

	it("attributes OpenRouter requests", () => {
		const openRouter = target("openrouter", "https://openrouter.ai/api/v1");
		expect(getAttributionHeaders(openRouter, { attribution: PI_ATTRIBUTION })).toEqual({
			"HTTP-Referer": "https://pi.dev",
			"X-OpenRouter-Title": "pi",
			"X-OpenRouter-Categories": "cli-agent",
		});
		expect(
			getAttributionHeaders(openRouter, {
				attribution: { ...ACME, categories: ["cli-agent", "cloud-agent"] },
			}),
		).toEqual({
			"HTTP-Referer": "https://acme.example",
			"X-OpenRouter-Title": "acme",
			"X-OpenRouter-Categories": "cli-agent,cloud-agent",
		});
		expect(getAttributionHeaders(openRouter, { attribution: { ...ACME, categories: [] } })).toEqual({
			"HTTP-Referer": "https://acme.example",
			"X-OpenRouter-Title": "acme",
		});
		// Custom providers routed through OpenRouter, including legacy base URLs that are not valid URLs.
		expect(
			getAttributionHeaders(target("custom", "not-a-url-openrouter.ai"), { attribution: PI_ATTRIBUTION }),
		).toMatchObject({ "X-OpenRouter-Title": "pi" });
	});

	it("attributes NVIDIA NIM requests with a capitalized name and OpenCode requests with the name", () => {
		expect(
			getAttributionHeaders(target("nvidia", "https://example.test/v1"), { attribution: PI_ATTRIBUTION }),
		).toEqual({
			"X-BILLING-INVOKE-ORIGIN": "Pi",
		});
		expect(
			getAttributionHeaders(target("custom-nim", "https://integrate.api.nvidia.com/v1"), { attribution: ACME }),
		).toEqual({ "X-BILLING-INVOKE-ORIGIN": "Acme" });
		expect(
			getAttributionHeaders(target("opencode", "https://opencode.ai/zen/v1"), { attribution: PI_ATTRIBUTION }),
		).toEqual({
			"x-opencode-client": "pi",
		});
		expect(getAttributionHeaders(target("custom", "https://opencode.ai/zen/v1"), { attribution: ACME })).toEqual({
			"x-opencode-client": "acme",
		});
	});

	it("does not attribute NVIDIA models routed through gateways to NVIDIA", () => {
		expect(
			getAttributionHeaders(target("openrouter", "https://openrouter.ai/api/v1"), { attribution: PI_ATTRIBUTION }),
		).not.toHaveProperty("X-BILLING-INVOKE-ORIGIN");
		expect(
			getAttributionHeaders(target("vercel-ai-gateway", "https://ai-gateway.vercel.sh/v1"), {
				attribution: PI_ATTRIBUTION,
			}),
		).toEqual({});
	});
});
