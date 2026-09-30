export function isNativeClientSetupEnabled(
  env: { SA360_NATIVE_CLIENT_SETUP_ENABLED?: string } = process.env
): boolean {
  return env.SA360_NATIVE_CLIENT_SETUP_ENABLED?.trim().toLowerCase() === "true";
}
