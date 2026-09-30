export function isNativeClientSetupEnabled(
  env: Pick<NodeJS.ProcessEnv, "SA360_NATIVE_CLIENT_SETUP_ENABLED"> = process.env
): boolean {
  return env.SA360_NATIVE_CLIENT_SETUP_ENABLED?.trim().toLowerCase() === "true";
}
