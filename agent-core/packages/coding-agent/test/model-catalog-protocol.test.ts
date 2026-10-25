import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { allowNetwork } from "./test-network-env.ts";

// Primus: built-in providers use the catalog shipped with the build. The upstream remote
// model catalog is never fetched, even when a catalog base URL is configured and network
// access is allowed.

describe("remote model catalog", () => {
	const requests: string[] = [];
	let server: Server;
	let catalogBaseUrl: string;

	beforeAll(async () => {
		server = createServer((request, response) => {
			requests.push(request.url ?? "/");
			response.writeHead(404).end();
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => resolve());
		});
		catalogBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});

	it("is not requested when refreshing built-in providers", async () => {
		allowNetwork();
		const runtime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			catalogBaseUrl,
			refreshOnCreate: false,
		});
		await runtime.setRuntimeApiKey("anthropic", "test-key");
		await runtime.setRuntimeApiKey("openai", "test-key");
		const refresh = await runtime.refresh({ allowNetwork: true, force: true, providers: ["anthropic", "openai"] });

		expect([...refresh.errors]).toEqual([]);
		expect(requests).toEqual([]);
		expect(runtime.getModel("anthropic", "claude-sonnet-5")).toMatchObject({ api: "anthropic-messages" });
		expect(runtime.getModel("openai", "gpt-5.5")).toMatchObject({ api: "openai-responses" });
	});
});
