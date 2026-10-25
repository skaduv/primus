export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.PRIMUS_EXPERIMENTAL === "1";
}
