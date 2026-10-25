import type { BugReportBundle } from "./bug-report.ts";

interface UploadBugReportOptions {
	token?: string;
	signal?: AbortSignal;
	gatewayUrl?: string;
}

/**
 * Primus: bug reports are never uploaded to the upstream gateway. Reports stay local
 * (the desktop app exports a diagnostics bundle instead).
 */
export async function uploadBugReport(
	_bundle: BugReportBundle,
	_options: UploadBugReportOptions = {},
): Promise<{ id: string }> {
	throw new Error("Bug report upload is disabled in this build.");
}
