import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
	spawn: vi.fn(),
	spawnSync: vi.fn(() => ({ status: 0 })),
}));

vi.mock("node:child_process", () => childProcessMocks);

import { shareSession } from "../src/modes/interactive/session-share.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("shareSession", () => {
	beforeAll(() => initTheme("dark"));
	beforeEach(() => vi.clearAllMocks());

	// Primus: sharing would upload the session to the upstream share service or a GitHub gist,
	// so it is disabled for every configured destination.
	it.each(["auto", "gist", "radius"])("is disabled for the %s destination", async (destination) => {
		const errors: string[] = [];
		const statuses: string[] = [];
		const exportToHtml = vi.fn();
		const getProvider = vi.fn();

		await shareSession({
			session: {
				sessionManager: { getSessionId: () => destination, getCwd: () => "/tmp", getBranch: () => [] },
				state: { systemPrompt: "", tools: [] },
				settingsManager: { getSessionShareDestination: () => destination },
				modelRuntime: { getProvider },
				exportToHtml,
			},
			ui: { setFocus() {}, requestRender() {} },
			editorContainer: { clear() {}, addChild() {} },
			editor: {},
			showStatus: (message: string) => statuses.push(message),
			showError: (message: string) => errors.push(message),
		} as never);

		expect(errors).toEqual(["Session sharing is disabled in this build. Use /export to save the session locally."]);
		expect(statuses).toEqual([]);
		expect(exportToHtml).not.toHaveBeenCalled();
		expect(getProvider).not.toHaveBeenCalled();
		expect(childProcessMocks.spawnSync).not.toHaveBeenCalled();
		expect(childProcessMocks.spawn).not.toHaveBeenCalled();
	});
});
