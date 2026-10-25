import type { ClientIdentity } from "@earendil-works/pi-ai";
import { VERSION } from "../config.ts";
import type { SettingsManager } from "./settings-manager.ts";

/**
 * How requests identify the app to providers: a detailed `User-Agent` with the Core version.
 * Primus: no provider attribution headers are sent (they would attribute traffic to the upstream project).
 */
export function getClientIdentity(_settingsManager: SettingsManager): ClientIdentity {
	return {
		userAgent: "detailed",
		version: VERSION,
		attribution: null,
	};
}
