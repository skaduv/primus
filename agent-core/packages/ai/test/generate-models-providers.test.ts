import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function tool(id: string) {
	return {
		id,
		name: id,
		tool_call: true,
		limit: { context: 200000, output: 64000 },
		cost: { input: 1, output: 2 },
	};
}

// models.dev lists many providers; the generator must keep only the two built-in ones
// and must not contact any other catalog (any other URL throws in the mock).
function writeMockFetch(root: string): string {
	const preloadPath = join(root, "mock-models-dev.mjs");
	const catalog = {
		anthropic: { models: { "claude-test": tool("claude-test") } },
		openai: { models: { "gpt-test": tool("gpt-test") } },
		groq: { models: { "llama-test": tool("llama-test") } },
		google: { models: { "gemini-test": tool("gemini-test") } },
		"amazon-bedrock": { models: { "anthropic.claude-test": tool("anthropic.claude-test") } },
	};
	writeFileSync(
		preloadPath,
		`const catalog = ${JSON.stringify(catalog)};\n` +
			`globalThis.fetch = async (input) => {\n` +
			`  if (String(input) === "https://models.dev/api.json") return Response.json(catalog);\n` +
			`  throw new Error(\`Unexpected fetch: \${String(input)}\`);\n` +
			`};\n`,
	);
	return preloadPath;
}

describe("model generation", () => {
	it("generates only the anthropic and openai providers without other catalogs", () => {
		const root = mkdtempSync(join(tmpdir(), "primus-generate-models-"));
		temporaryRoots.push(root);
		const outputPath = join(root, "catalog");
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				pathToFileURL(writeMockFetch(root)).href,
				"scripts/generate-models.ts",
				"--strict",
				"--json-only",
				"--json-output",
				outputPath,
			],
			{ cwd: packageRoot, encoding: "utf8", timeout: 20_000 },
		);
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(readFileSync(join(outputPath, "providers.json"), "utf8"))).toEqual(["anthropic", "openai"]);
		const all = JSON.parse(readFileSync(join(outputPath, "models.all.json"), "utf8")) as Record<
			string,
			{ id: string; api: string; type: string }[]
		>;
		expect(all.anthropic.map((model) => [model.id, model.api, model.type])).toEqual([
			["claude-test", "anthropic-messages", "chat"],
		]);
		// The generator also adds a few hand-maintained OpenAI models that models.dev lacks.
		expect(all.openai.map((model) => model.id)).toContain("gpt-test");
		expect(new Set(all.openai.map((model) => `${model.api}/${model.type}`))).toEqual(
			new Set(["openai-responses/chat"]),
		);
	});

	it("writes the same models.generated.ts aggregator that is checked in", () => {
		const root = mkdtempSync(join(tmpdir(), "primus-generate-models-"));
		temporaryRoots.push(root);
		const isolatedPackageRoot = join(root, "package");
		mkdirSync(isolatedPackageRoot);
		for (const entry of ["package.json", "scripts", "src"]) {
			cpSync(join(packageRoot, entry), join(isolatedPackageRoot, entry), { recursive: true });
		}
		const result = spawnSync(
			process.execPath,
			["--import", pathToFileURL(writeMockFetch(root)).href, "scripts/generate-models.ts", "--strict"],
			{ cwd: isolatedPackageRoot, encoding: "utf8", timeout: 20_000 },
		);
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
		for (const path of [
			"src/models.generated.ts",
			"src/providers/anthropic.models.ts",
			"src/providers/openai.models.ts",
		]) {
			expect(readFileSync(join(isolatedPackageRoot, path), "utf8")).toBe(
				readFileSync(join(packageRoot, path), "utf8"),
			);
		}
	});
});
